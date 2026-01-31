-- Fix the process_staged_trades function to correctly calculate Gross Buy and Gross Sell
-- The issue is the trade_agg CTE is not properly filtering by side = 'BUY' or 'SELL'

CREATE OR REPLACE FUNCTION process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_result jsonb;
  v_prev_date date;
  v_trade_count integer := 0;
  v_investor_count integer := 0;
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
BEGIN
  -- Get previous business day for baseline
  SELECT MAX(as_of_date) INTO v_prev_date
  FROM balances_raw
  WHERE as_of_date < p_trade_date;

  -- Delete existing records for this date (idempotent)
  DELETE FROM eod_investor_balance WHERE trade_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Calculate trade statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN side = 'BUY' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'SELL' THEN qty * price ELSE 0 END), 0)
  INTO v_trade_count, v_gross_buy, v_gross_sell
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Calculate deposit/withdrawal statistics
  SELECT 
    COUNT(*) FILTER (WHERE type = 'DEPOSIT'),
    COUNT(*) FILTER (WHERE type = 'WITHDRAWAL'),
    COALESCE(SUM(amount) FILTER (WHERE type = 'DEPOSIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'WITHDRAWAL'), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Insert ledger snapshots using bulk operations with CTEs
  WITH baseline AS (
    SELECT 
      investor_code,
      SUM(ledger_balance) as opening_balance,
      SUM(total_mv) as baseline_mv,
      SUM(matured_balance) as matured_balance,
      SUM(receivable_sale) as receivable_sale,
      SUM(cq_in_transit) as cq_in_transit
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    GROUP BY investor_code
  ),
  trade_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN side = 'BUY' THEN qty * price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN side = 'SELL' THEN qty * price ELSE 0 END) as gross_sell,
      SUM(commission) as total_commission
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code
  ),
  cash_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  ),
  employee_lookup AS (
    SELECT email, employee_id, name, department
    FROM employees
    WHERE status = 'Active'
  ),
  snapshot_data AS (
    SELECT 
      inv.investor_code,
      inv.investor_name,
      inv.account_type,
      inv.brokerage_commission,
      inv.interest_rate,
      inv.rm_id,
      inv.rm_name,
      inv.department,
      emp.email as rm_email,
      COALESCE(b.opening_balance, 0) as opening_balance,
      COALESCE(b.matured_balance, 0) as matured_balance,
      COALESCE(b.receivable_sale, 0) as receivable_sale,
      COALESCE(b.cq_in_transit, 0) as cq_in_transit,
      COALESCE(t.gross_buy, 0) as gross_buy,
      COALESCE(t.gross_sell, 0) as gross_sell,
      COALESCE(t.total_commission, 0) as trade_commission,
      COALESCE(c.deposits, 0) as deposits,
      COALESCE(c.withdrawals, 0) as withdrawals,
      COALESCE(b.baseline_mv, 0) as baseline_mv
    FROM investors inv
    LEFT JOIN baseline b ON b.investor_code = inv.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = inv.investor_code
    LEFT JOIN cash_agg c ON c.investor_code = inv.investor_code
    LEFT JOIN employee_lookup emp ON emp.employee_id = inv.rm_id
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, account_type, 
    brokerage_rate, interest_rate, rm_id, rm_name, rm_email, department,
    opening_balance, matured_balance, receivable_sale, cq_in_transit,
    gross_buy, gross_sell, total_commission, total_deposits, total_withdrawals,
    ledger_balance, closing_balance, total_mv
  )
  SELECT 
    p_trade_date,
    investor_code,
    investor_name,
    account_type,
    brokerage_commission,
    interest_rate,
    rm_id,
    rm_name,
    rm_email,
    department,
    opening_balance,
    matured_balance,
    receivable_sale,
    cq_in_transit,
    gross_buy,
    gross_sell,
    trade_commission,
    deposits,
    withdrawals,
    -- ledger_balance = opening + deposits - withdrawals + sell - buy - commission
    opening_balance + deposits - withdrawals + gross_sell - gross_buy - trade_commission,
    -- closing_balance same as ledger_balance for now
    opening_balance + deposits - withdrawals + gross_sell - gross_buy - trade_commission,
    baseline_mv
  FROM snapshot_data;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Calculate commission total
  SELECT COALESCE(SUM(total_commission), 0) INTO v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- Count investors with trades
  SELECT COUNT(DISTINCT investor_code) INTO v_investor_count
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Count RM assignments and departments
  SELECT 
    COUNT(*) FILTER (WHERE rm_id IS NOT NULL),
    COUNT(*) FILTER (WHERE department IS NOT NULL)
  INTO v_with_rm_assigned, v_with_department
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- Insert instrument positions
  WITH position_agg AS (
    SELECT 
      investor_code,
      instrument,
      SUM(CASE WHEN side = 'BUY' THEN qty ELSE -qty END) as net_qty,
      SUM(CASE WHEN side = 'BUY' THEN qty * price ELSE 0 END) as buy_cost,
      SUM(CASE WHEN side = 'BUY' THEN qty ELSE 0 END) as buy_qty
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code, instrument
  ),
  priced AS (
    SELECT 
      pa.investor_code,
      pa.instrument,
      pa.net_qty as total_stock,
      pa.net_qty as saleable,
      CASE WHEN pa.buy_qty > 0 THEN pa.buy_cost / pa.buy_qty ELSE 0 END as avg_cost,
      pa.buy_cost as total_cost,
      pa.net_qty * COALESCE(s.close_price, 0) as total_market_value
    FROM position_agg pa
    LEFT JOIN securities s ON s.trading_code = pa.instrument
  )
  INSERT INTO eod_instrument_position (
    trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value
  )
  SELECT p_trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value
  FROM priced;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Calculate market value total
  SELECT COALESCE(SUM(total_market_value), 0) INTO v_total_market_value
  FROM eod_instrument_position
  WHERE trade_date = p_trade_date;

  -- Count instruments priced
  SELECT COUNT(DISTINCT instrument) INTO v_instruments_priced
  FROM eod_instrument_position
  WHERE trade_date = p_trade_date;

  -- Insert investor balance records
  INSERT INTO eod_investor_balance (
    trade_date, investor_code, opening_ledger_balance, closing_ledger_balance, 
    matured_balance, receivable_sales, cheque_in_tran_hand, accrued_int, equity, rm_id
  )
  SELECT 
    p_trade_date,
    investor_code,
    opening_balance,
    closing_balance,
    matured_balance,
    receivable_sale,
    cq_in_transit,
    0, -- accrued_int calculated separately
    closing_balance + COALESCE((
      SELECT SUM(total_market_value) 
      FROM eod_instrument_position ip 
      WHERE ip.investor_code = els.investor_code AND ip.trade_date = p_trade_date
    ), 0),
    rm_id
  FROM eod_ledger_snapshots els
  WHERE eod_date = p_trade_date;

  -- Calculate margin metrics
  SELECT 
    COUNT(*),
    COALESCE(SUM(ABS(closing_balance)), 0)
  INTO v_margin_accounts, v_margin_exposure
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date AND closing_balance < 0;

  -- Calculate total equity
  SELECT COALESCE(SUM(equity), 0) INTO v_total_equity
  FROM eod_investor_balance
  WHERE trade_date = p_trade_date;

  -- Count negative equity
  SELECT COUNT(*) INTO v_negative_equity_count
  FROM eod_investor_balance
  WHERE trade_date = p_trade_date AND equity < 0;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_investor_count,
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