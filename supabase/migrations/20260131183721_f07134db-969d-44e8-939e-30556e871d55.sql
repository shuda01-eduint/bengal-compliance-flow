
-- Optimized process_staged_trades with increased timeout and efficient bulk operations
CREATE OR REPLACE FUNCTION process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_result jsonb;
  v_trade_count integer := 0;
  v_investor_count integer := 0;
  v_total_investors integer := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_deposit_count integer := 0;
  v_withdrawal_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_positions_captured integer := 0;
  v_total_market_value numeric := 0;
  v_snapshots_created integer := 0;
  v_margin_accounts integer := 0;
  v_margin_exposure numeric := 0;
  v_total_equity numeric := 0;
  v_negative_equity_count integer := 0;
  v_with_rm_assigned integer := 0;
  v_with_department integer := 0;
  v_prev_date date;
BEGIN
  -- Get previous business day for baseline
  SELECT MAX(as_of_date) INTO v_prev_date
  FROM balances_raw
  WHERE as_of_date < p_trade_date;

  -- Get total investor count
  SELECT COUNT(*) INTO v_total_investors FROM investors;

  -- Get trade statistics
  SELECT 
    COUNT(*),
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(CASE WHEN side = 'B' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'S' THEN qty * price ELSE 0 END), 0)
  INTO v_trade_count, v_investor_count, v_gross_buy, v_gross_sell
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Calculate commission using investor brokerage rates
  SELECT COALESCE(SUM(t.qty * t.price * 
    CASE 
      WHEN i.brokerage_commission IS NULL THEN 0.004
      WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
      ELSE i.brokerage_commission
    END
  ), 0) INTO v_total_commission
  FROM trade_file t
  LEFT JOIN investors i ON t.investor_code = i.investor_code
  WHERE t.trade_date = p_trade_date;

  -- Get deposit/withdrawal statistics
  SELECT 
    COUNT(*) FILTER (WHERE type IN ('DEPOSIT', 'CR')),
    COUNT(*) FILTER (WHERE type IN ('WITHDRAWAL', 'DR')),
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAWAL', 'DR') THEN ABS(amount) ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Delete existing records for this date (idempotent re-run)
  DELETE FROM eod_investor_balance WHERE trade_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Insert investor balances using pre-aggregated CTEs (no correlated subqueries)
  WITH baseline AS (
    SELECT DISTINCT ON (investor_code) 
      investor_code, ledger_balance, matured_balance, receivable_sale, 
      cq_in_transit, total_mv, rm_id
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    ORDER BY investor_code, updated_at DESC
  ),
  trade_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN side = 'B' THEN qty * price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN side = 'S' THEN qty * price ELSE 0 END) as gross_sell
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code
  ),
  cash_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE -ABS(amount) END) as net_cash
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  )
  INSERT INTO eod_investor_balance (
    investor_code, trade_date, opening_ledger_balance, matured_balance,
    receivable_sales, cheque_in_tran_hand, accrued_int, closing_ledger_balance,
    equity, boid, rm_id
  )
  SELECT 
    b.investor_code,
    p_trade_date,
    COALESCE(b.ledger_balance, 0),
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    0,
    COALESCE(b.ledger_balance, 0) 
      - COALESCE(t.gross_buy, 0) 
      + COALESCE(t.gross_sell, 0) 
      + COALESCE(c.net_cash, 0),
    COALESCE(b.total_mv, 0),
    inv.bo_id,
    b.rm_id
  FROM baseline b
  LEFT JOIN investors inv ON b.investor_code = inv.investor_code
  LEFT JOIN trade_agg t ON b.investor_code = t.investor_code
  LEFT JOIN cash_agg c ON b.investor_code = c.investor_code;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Insert instrument positions (bulk)
  INSERT INTO eod_instrument_position (
    investor_code, instrument, trade_date, total_stock, saleable,
    avg_cost, total_cost, total_market_value
  )
  SELECT 
    investor_code, instrument, p_trade_date,
    COALESCE(total_stock, 0), COALESCE(saleable, 0),
    COALESCE(avg_cost, 0), COALESCE(total_cost, 0), COALESCE(total_mv, 0)
  FROM balances_raw
  WHERE as_of_date = v_prev_date
    AND instrument IS NOT NULL AND instrument != '';

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Calculate market value
  SELECT COALESCE(SUM(total_market_value), 0) INTO v_total_market_value
  FROM eod_instrument_position WHERE trade_date = p_trade_date;

  -- Insert ledger snapshots using efficient CTEs
  WITH baseline AS (
    SELECT DISTINCT ON (investor_code) 
      investor_code, ledger_balance, total_mv, total_cost, avg_cost, 
      total_stock, saleable, matured_balance, receivable_sale, cq_in_transit, 
      rm_id, rm_email
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    ORDER BY investor_code, updated_at DESC
  ),
  trade_agg AS (
    SELECT 
      t.investor_code,
      SUM(CASE WHEN side = 'B' THEN qty * price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN side = 'S' THEN qty * price ELSE 0 END) as gross_sell,
      SUM(qty * price * 
        CASE 
          WHEN i.brokerage_commission IS NULL THEN 0.004
          WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
          ELSE i.brokerage_commission
        END
      ) as commission
    FROM trade_file t
    LEFT JOIN investors i ON t.investor_code = i.investor_code
    WHERE t.trade_date = p_trade_date
    GROUP BY t.investor_code
  ),
  cash_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type IN ('WITHDRAWAL', 'DR') THEN ABS(amount) ELSE 0 END) as total_withdrawals,
      SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE -ABS(amount) END) as net_deposits
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, ledger_balance, 
    opening_balance, closing_balance, gross_buy, gross_sell,
    total_commission, total_deposits, total_withdrawals,
    rm_id, rm_name, rm_email, department, brokerage_rate,
    total_mv, total_cost, avg_cost, total_stock, saleable,
    matured_balance, receivable_sale, cq_in_transit,
    accrued_interest, cumulative_interest, interest_rate, account_type
  )
  SELECT 
    p_trade_date,
    inv.investor_code,
    inv.investor_name,
    COALESCE(b.ledger_balance, 0),
    COALESCE(b.ledger_balance, 0),
    COALESCE(b.ledger_balance, 0) 
      - COALESCE(t.gross_buy, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.commission, 0) 
      + COALESCE(c.net_deposits, 0),
    COALESCE(t.gross_buy, 0),
    COALESCE(t.gross_sell, 0),
    COALESCE(t.commission, 0),
    COALESCE(c.total_deposits, 0),
    COALESCE(c.total_withdrawals, 0),
    emp.employee_id,
    emp.name,
    emp.email,
    emp.department,
    CASE 
      WHEN inv.brokerage_commission IS NULL THEN 0.004
      WHEN inv.brokerage_commission >= 0.1 THEN inv.brokerage_commission / 100
      ELSE inv.brokerage_commission
    END,
    COALESCE(b.total_mv, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    0, 0,
    COALESCE(inv.interest_rate, 0),
    inv.account_type
  FROM investors inv
  LEFT JOIN baseline b ON inv.investor_code = b.investor_code
  LEFT JOIN trade_agg t ON inv.investor_code = t.investor_code
  LEFT JOIN cash_agg c ON inv.investor_code = c.investor_code
  LEFT JOIN employees emp ON LOWER(b.rm_email) = LOWER(emp.email);

  -- Calculate final metrics
  SELECT COUNT(*) INTO v_with_rm_assigned
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date AND rm_id IS NOT NULL;

  SELECT COUNT(*) INTO v_with_department
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date AND department IS NOT NULL;

  SELECT 
    COALESCE(SUM(COALESCE(total_mv, 0) - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)), 0),
    COUNT(*) FILTER (WHERE (COALESCE(total_mv, 0) - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)) < 0)
  INTO v_total_equity, v_negative_equity_count
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  SELECT COUNT(*), COALESCE(SUM(ABS(LEAST(closing_balance, 0))), 0)
  INTO v_margin_accounts, v_margin_exposure
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date AND closing_balance < 0;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_total_investors,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'deposit_count', v_deposit_count,
    'withdrawal_count', v_withdrawal_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'instruments_priced', 0,
    'positions_captured', v_positions_captured,
    'total_market_value', v_total_market_value,
    'snapshots_created', v_snapshots_created,
    'margin_accounts', v_margin_accounts,
    'margin_exposure', v_margin_exposure,
    'daily_interest_total', 0,
    'cumulative_interest_total', 0,
    'total_equity', v_total_equity,
    'negative_equity_count', v_negative_equity_count,
    'with_rm_assigned', v_with_rm_assigned,
    'with_department', v_with_department
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;

-- Add indexes if missing for performance
CREATE INDEX IF NOT EXISTS idx_balances_raw_as_of_date ON balances_raw(as_of_date);
CREATE INDEX IF NOT EXISTS idx_balances_raw_investor_code ON balances_raw(investor_code);
CREATE INDEX IF NOT EXISTS idx_trade_file_trade_date ON trade_file(trade_date);
CREATE INDEX IF NOT EXISTS idx_trade_file_investor_code ON trade_file(investor_code);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_txn_txn_date ON cash_ledger_txn(txn_date);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_txn_investor_code ON cash_ledger_txn(investor_code);
CREATE INDEX IF NOT EXISTS idx_eod_ledger_snapshots_eod_date ON eod_ledger_snapshots(eod_date);
CREATE INDEX IF NOT EXISTS idx_eod_instrument_position_trade_date ON eod_instrument_position(trade_date);
CREATE INDEX IF NOT EXISTS idx_eod_investor_balance_trade_date ON eod_investor_balance(trade_date);
