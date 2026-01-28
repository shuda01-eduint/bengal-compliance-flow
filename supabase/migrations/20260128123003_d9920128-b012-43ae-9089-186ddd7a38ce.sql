
-- Fix run_batch_eod to use DELTA calculation for deposits/withdrawals
-- The trade_history stores CUMULATIVE totals, not daily amounts
-- We calculate daily by: today's cumulative - previous day's cumulative

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date DATE, p_user_id UUID DEFAULT NULL, p_skip_existing BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_user_email TEXT;
  v_eod_date_text TEXT;
BEGIN
  -- Check admin role
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin role required');
  END IF;

  -- Convert date to YYYYMMDD format for trade_history comparison
  v_eod_date_text := to_char(p_eod_date, 'YYYYMMDD');

  -- Get user email
  SELECT email INTO v_user_email FROM auth.users WHERE id = COALESCE(p_user_id, auth.uid());

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'message', 'EOD already exists for this date');
  END IF;

  -- Delete existing snapshots for this date if re-running
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Count trade files for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history WHERE trade_date = v_eod_date_text;

  -- Count deposit records for this date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals WHERE transaction_date = p_eod_date;

  -- Main EOD calculation with DELTA approach for deposits/withdrawals
  WITH 
  -- Get the previous trading day (for delta calculation)
  prev_trade_date AS (
    SELECT MAX(trade_date) as prev_date
    FROM trade_history
    WHERE trade_date < v_eod_date_text
  ),
  
  -- Today's cumulative deposits/withdrawals from trade_history
  cumulative_today AS (
    SELECT 
      client_code,
      MAX(total_deposits) AS cum_deposits,
      MAX(total_withdrawals) AS cum_withdrawals,
      MAX(ledger_balance_snapshot) AS ledger_snapshot
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  
  -- Previous day's cumulative deposits/withdrawals (for delta calculation)
  cumulative_prev AS (
    SELECT 
      client_code,
      MAX(total_deposits) AS cum_deposits,
      MAX(total_withdrawals) AS cum_withdrawals
    FROM trade_history t, prev_trade_date p
    WHERE t.trade_date = p.prev_date
    GROUP BY client_code
  ),
  
  -- Calculate DAILY deposits/withdrawals as delta
  daily_deposits AS (
    SELECT 
      COALESCE(t.client_code, p.client_code) AS investor_code,
      GREATEST(COALESCE(t.cum_deposits, 0) - COALESCE(p.cum_deposits, 0), 0) AS deposits,
      GREATEST(COALESCE(t.cum_withdrawals, 0) - COALESCE(p.cum_withdrawals, 0), 0) AS withdrawals,
      t.ledger_snapshot
    FROM cumulative_today t
    FULL OUTER JOIN cumulative_prev p ON t.client_code = p.client_code
    WHERE t.client_code IS NOT NULL
  ),
  
  -- Daily trades aggregation
  daily_trades AS (
    SELECT 
      client_code AS investor_code,
      COALESCE(SUM(CASE WHEN side = 'B' THEN value ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN side = 'S' THEN value ELSE 0 END), 0) AS gross_sell,
      COALESCE(SUM(brokerage_commission), 0) AS commission
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  
  -- Universe of all investors to process
  universe AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM investors WHERE status = 'Active'
      UNION
      SELECT client_code AS investor_code FROM trade_history WHERE trade_date = v_eod_date_text
      UNION
      SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date < p_eod_date
      UNION
      SELECT investor_code FROM daily_deposits
    ) u
  ),
  
  -- Get previous closing balances (opening balance for today)
  prev_closing AS (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date < p_eod_date
    ORDER BY investor_code, eod_date DESC
  ),
  
  -- Get investor master data for baseline and metadata
  investor_data AS (
    SELECT 
      investor_code,
      investor_name,
      ledger_balance AS baseline_ledger,
      brokerage_commission,
      interest_rate,
      account_type,
      rm_id,
      rm_name,
      department
    FROM investors
  ),
  
  -- Calculate final balances
  final_calc AS (
    SELECT 
      u.investor_code,
      inv.investor_name,
      inv.account_type,
      inv.rm_id,
      inv.rm_name,
      inv.department,
      inv.brokerage_commission AS brokerage_rate,
      inv.interest_rate,
      -- Opening balance: previous closing → baseline → 0
      COALESCE(pc.closing_balance, inv.baseline_ledger, 0) AS opening_balance,
      -- Daily activity
      COALESCE(dd.deposits, 0) AS deposits,
      COALESCE(dd.withdrawals, 0) AS withdrawals,
      COALESCE(dt.gross_buy, 0) AS gross_buy,
      COALESCE(dt.gross_sell, 0) AS gross_sell,
      COALESCE(dt.commission, 0) AS commission,
      -- Ledger snapshot from trade file (for audit)
      dd.ledger_snapshot,
      -- Closing balance calculation
      COALESCE(pc.closing_balance, inv.baseline_ledger, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0) 
        + COALESCE(dt.gross_sell, 0) 
        - COALESCE(dt.gross_buy, 0) 
        - COALESCE(dt.commission, 0) AS closing_balance
    FROM universe u
    LEFT JOIN investor_data inv ON inv.investor_code = u.investor_code
    LEFT JOIN prev_closing pc ON pc.investor_code = u.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = u.investor_code
    LEFT JOIN daily_trades dt ON dt.investor_code = u.investor_code
  )
  
  -- Insert EOD snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    account_type,
    rm_id,
    rm_name,
    department,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    closing_balance,
    ledger_balance,
    ledger_balance_snapshot,
    brokerage_rate,
    interest_rate,
    created_by
  )
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    account_type,
    rm_id,
    rm_name,
    department,
    opening_balance,
    deposits,
    withdrawals,
    gross_buy,
    gross_sell,
    commission,
    closing_balance,
    closing_balance,  -- ledger_balance = closing_balance
    ledger_snapshot,
    brokerage_rate,
    interest_rate,
    COALESCE(p_user_id, auth.uid())
  FROM final_calc;

  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_clients_captured,
    v_total_ledger_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Snapshot holdings
  INSERT INTO eod_holding_snapshots (
    eod_date, investor_code, security_code, total_qty, total_qty_saleable,
    avg_cost, total_cost, market_value
  )
  SELECT 
    p_eod_date,
    investor_code,
    trading_code,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    market_value
  FROM holdings;

  -- Record run history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    trade_files_count,
    deposit_records_count,
    status
  ) VALUES (
    p_eod_date,
    COALESCE(p_user_id, auth.uid()),
    v_user_email,
    v_clients_captured,
    v_total_ledger_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_trade_files_count,
    v_deposit_records_count,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'eod_date', p_eod_date
  );
END;
$$;
