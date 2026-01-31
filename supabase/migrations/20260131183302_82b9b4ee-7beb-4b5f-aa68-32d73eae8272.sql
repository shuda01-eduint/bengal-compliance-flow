
-- Fix duplicate key constraint violation in process_staged_trades by using UPSERT
CREATE OR REPLACE FUNCTION process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_instruments_priced integer := 0;
  v_positions_captured integer := 0;
  v_total_market_value numeric := 0;
  v_snapshots_created integer := 0;
  v_margin_accounts integer := 0;
  v_margin_exposure numeric := 0;
  v_daily_interest_total numeric := 0;
  v_cumulative_interest_total numeric := 0;
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

  -- Get trade statistics with commission calculation
  SELECT 
    COUNT(*),
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(CASE WHEN side = 'B' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'S' THEN qty * price ELSE 0 END), 0)
  INTO v_trade_count, v_investor_count, v_gross_buy, v_gross_sell
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Calculate commission from trades using investor brokerage rates
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

  -- Get deposit/withdrawal statistics for the specific date
  SELECT 
    COUNT(*) FILTER (WHERE type IN ('DEPOSIT', 'CR')),
    COUNT(*) FILTER (WHERE type IN ('WITHDRAWAL', 'DR')),
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAWAL', 'DR') THEN ABS(amount) ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Delete existing eod_investor_balance records for this date to avoid duplicates
  DELETE FROM eod_investor_balance WHERE trade_date = p_trade_date;

  -- Delete existing eod_instrument_position records for this date
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;

  -- Delete existing eod_ledger_snapshots for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Insert investor balances using baseline from balances_raw
  INSERT INTO eod_investor_balance (
    investor_code, trade_date, opening_ledger_balance, matured_balance,
    receivable_sales, cheque_in_tran_hand, accrued_int, closing_ledger_balance,
    equity, boid, rm_id
  )
  SELECT 
    b.investor_code,
    p_trade_date,
    COALESCE(b.ledger_balance, 0) as opening_ledger_balance,
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    0 as accrued_int,
    COALESCE(b.ledger_balance, 0) 
      - COALESCE((SELECT SUM(CASE WHEN side = 'B' THEN qty * price ELSE 0 END) FROM trade_file WHERE trade_file.investor_code = b.investor_code AND trade_date = p_trade_date), 0)
      + COALESCE((SELECT SUM(CASE WHEN side = 'S' THEN qty * price ELSE 0 END) FROM trade_file WHERE trade_file.investor_code = b.investor_code AND trade_date = p_trade_date), 0)
      + COALESCE((SELECT SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE -ABS(amount) END) FROM cash_ledger_txn WHERE cash_ledger_txn.investor_code = b.investor_code AND txn_date = p_trade_date), 0)
    as closing_ledger_balance,
    COALESCE(b.total_mv, 0) as equity,
    inv.bo_id,
    b.rm_id
  FROM (
    SELECT DISTINCT ON (investor_code) *
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    ORDER BY investor_code, updated_at DESC
  ) b
  LEFT JOIN investors inv ON b.investor_code = inv.investor_code;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Insert instrument positions
  INSERT INTO eod_instrument_position (
    investor_code, instrument, trade_date, total_stock, saleable,
    avg_cost, total_cost, total_market_value
  )
  SELECT 
    b.investor_code,
    b.instrument,
    p_trade_date,
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.total_mv, 0)
  FROM balances_raw b
  WHERE b.as_of_date = v_prev_date
    AND b.instrument IS NOT NULL
    AND b.instrument != '';

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Calculate market value
  SELECT COALESCE(SUM(total_market_value), 0) INTO v_total_market_value
  FROM eod_instrument_position
  WHERE trade_date = p_trade_date;

  -- Insert ledger snapshots with commission calculation
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
    COALESCE(b.ledger_balance, 0) as opening_balance,
    COALESCE(b.ledger_balance, 0) 
      - COALESCE(trades.gross_buy, 0)
      + COALESCE(trades.gross_sell, 0)
      - COALESCE(trades.commission, 0)
      + COALESCE(deps.net_deposits, 0) as closing_balance,
    COALESCE(trades.gross_buy, 0),
    COALESCE(trades.gross_sell, 0),
    COALESCE(trades.commission, 0),
    COALESCE(deps.total_deposits, 0),
    COALESCE(deps.total_withdrawals, 0),
    emp.employee_id,
    emp.name,
    emp.email,
    emp.department,
    CASE 
      WHEN inv.brokerage_commission IS NULL THEN 0.004
      WHEN inv.brokerage_commission >= 0.1 THEN inv.brokerage_commission / 100
      ELSE inv.brokerage_commission
    END as brokerage_rate,
    COALESCE(b.total_mv, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    0 as accrued_interest,
    0 as cumulative_interest,
    COALESCE(inv.interest_rate, 0),
    inv.account_type
  FROM investors inv
  LEFT JOIN (
    SELECT investor_code, 
           ledger_balance, total_mv, total_cost, avg_cost, total_stock, saleable,
           matured_balance, receivable_sale, cq_in_transit, rm_id, rm_email
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY investor_code ORDER BY updated_at DESC) as rn
      FROM balances_raw
      WHERE as_of_date = v_prev_date
    ) ranked WHERE rn = 1
  ) b ON inv.investor_code = b.investor_code
  LEFT JOIN (
    SELECT 
      investor_code,
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
    WHERE trade_date = p_trade_date
    GROUP BY t.investor_code
  ) trades ON inv.investor_code = trades.investor_code
  LEFT JOIN (
    SELECT 
      investor_code,
      SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type IN ('WITHDRAWAL', 'DR') THEN ABS(amount) ELSE 0 END) as total_withdrawals,
      SUM(CASE WHEN type IN ('DEPOSIT', 'CR') THEN ABS(amount) ELSE -ABS(amount) END) as net_deposits
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  ) deps ON inv.investor_code = deps.investor_code
  LEFT JOIN employees emp ON LOWER(b.rm_email) = LOWER(emp.email);

  -- Count RM assignments and departments
  SELECT COUNT(*) INTO v_with_rm_assigned
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date AND rm_id IS NOT NULL;

  SELECT COUNT(*) INTO v_with_department
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date AND department IS NOT NULL;

  -- Calculate equity metrics
  SELECT 
    COALESCE(SUM(COALESCE(total_mv, 0) - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)), 0),
    COUNT(*) FILTER (WHERE (COALESCE(total_mv, 0) - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)) < 0)
  INTO v_total_equity, v_negative_equity_count
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- Count margin accounts
  SELECT COUNT(*), COALESCE(SUM(ABS(LEAST(closing_balance, 0))), 0)
  INTO v_margin_accounts, v_margin_exposure
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date AND closing_balance < 0;

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
    'instruments_priced', v_instruments_priced,
    'positions_captured', v_positions_captured,
    'total_market_value', v_total_market_value,
    'snapshots_created', v_snapshots_created,
    'margin_accounts', v_margin_accounts,
    'margin_exposure', v_margin_exposure,
    'daily_interest_total', v_daily_interest_total,
    'cumulative_interest_total', v_cumulative_interest_total,
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
