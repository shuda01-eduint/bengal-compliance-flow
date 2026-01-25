-- Step 1: Populate eod_holding_snapshots from current holdings for the latest EOD date
INSERT INTO eod_holding_snapshots (
  investor_code, eod_date, security_code, 
  total_qty_saleable, total_qty, avg_cost, total_cost, market_value
)
SELECT 
  h.investor_code,
  (SELECT MAX(eod_date) FROM eod_ledger_snapshots) AS eod_date,
  h.trading_code AS security_code,
  h.saleable AS total_qty_saleable,
  h.total_stock AS total_qty,
  h.avg_cost,
  h.total_cost,
  h.market_value
FROM holdings h
WHERE EXISTS (
  SELECT 1 FROM eod_ledger_snapshots e 
  WHERE e.investor_code = h.investor_code
)
ON CONFLICT (investor_code, eod_date, security_code) DO UPDATE SET
  total_qty_saleable = EXCLUDED.total_qty_saleable,
  total_qty = EXCLUDED.total_qty,
  avg_cost = EXCLUDED.avg_cost,
  total_cost = EXCLUDED.total_cost,
  market_value = EXCLUDED.market_value;

-- Step 2: Update run_batch_eod function to capture holdings during EOD runs
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_holdings_captured integer := 0;
BEGIN
  -- Check admin role
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access denied: Admin role required'
    );
  END IF;

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Build universe of all investors to process
  WITH universe AS (
    SELECT DISTINCT inv_code FROM (
      SELECT investor_code AS inv_code FROM investors WHERE status = 'Active'
      UNION
      SELECT client_code AS inv_code FROM trade_history WHERE trade_date = p_eod_date
      UNION
      SELECT investor_code AS inv_code FROM deposits_withdrawals WHERE transaction_date = p_eod_date
      UNION
      SELECT investor_code AS inv_code FROM eod_ledger_snapshots WHERE eod_date = p_eod_date - 1
    ) all_codes
  ),
  -- Get previous day's closing balances
  prev_day AS (
    SELECT investor_code, closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - 1
  ),
  -- Calculate daily activity
  daily_trades AS (
    SELECT 
      client_code AS investor_code,
      COALESCE(SUM(CASE WHEN side = 'B' THEN value ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN side = 'S' THEN value ELSE 0 END), 0) AS gross_sell,
      COALESCE(SUM(brokerage_commission), 0) AS commission
    FROM trade_history
    WHERE trade_date = p_eod_date
    GROUP BY client_code
  ),
  daily_deposits AS (
    SELECT 
      investor_code,
      COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Get investor metadata
  investor_meta AS (
    SELECT 
      investor_code, investor_name, rm_id, rm_name, department, 
      interest_rate, brokerage_commission, account_type
    FROM investors
  ),
  -- Calculate snapshots
  snapshots AS (
    SELECT 
      u.inv_code AS investor_code,
      p_eod_date AS eod_date,
      COALESCE(im.investor_name, '') AS investor_name,
      COALESCE(im.rm_id, '') AS rm_id,
      COALESCE(im.rm_name, '') AS rm_name,
      COALESCE(im.department, '') AS department,
      COALESCE(im.interest_rate, 0) AS interest_rate,
      COALESCE(im.brokerage_commission, 0) AS brokerage_rate,
      COALESCE(im.account_type, '') AS account_type,
      COALESCE(pd.closing_balance, 0) AS opening_balance,
      COALESCE(dd.deposits, 0) AS total_deposits,
      COALESCE(dd.withdrawals, 0) AS total_withdrawals,
      COALESCE(dt.gross_buy, 0) AS gross_buy,
      COALESCE(dt.gross_sell, 0) AS gross_sell,
      COALESCE(dt.commission, 0) AS total_commission,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Commission
      COALESCE(pd.closing_balance, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0) 
        + COALESCE(dt.gross_sell, 0) 
        - COALESCE(dt.gross_buy, 0) 
        - COALESCE(dt.commission, 0) AS closing_balance,
      -- Calculate daily interest on previous closing balance (if negative = margin loan)
      CASE 
        WHEN COALESCE(pd.closing_balance, 0) < 0 
        THEN ABS(COALESCE(pd.closing_balance, 0)) * COALESCE(im.interest_rate, 0) / 100 / 365
        ELSE 0
      END AS accrued_interest,
      COALESCE(pd.cumulative_interest, 0) + 
      CASE 
        WHEN COALESCE(pd.closing_balance, 0) < 0 
        THEN ABS(COALESCE(pd.closing_balance, 0)) * COALESCE(im.interest_rate, 0) / 100 / 365
        ELSE 0
      END AS cumulative_interest
    FROM universe u
    LEFT JOIN prev_day pd ON pd.investor_code = u.inv_code
    LEFT JOIN daily_trades dt ON dt.investor_code = u.inv_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = u.inv_code
    LEFT JOIN investor_meta im ON im.investor_code = u.inv_code
  )
  -- Upsert snapshots
  INSERT INTO eod_ledger_snapshots (
    investor_code, eod_date, investor_name, rm_id, rm_name, department,
    interest_rate, brokerage_rate, account_type,
    opening_balance, total_deposits, total_withdrawals,
    gross_buy, gross_sell, total_commission,
    closing_balance, ledger_balance, accrued_interest, cumulative_interest,
    created_by
  )
  SELECT 
    investor_code, eod_date, investor_name, rm_id, rm_name, department,
    interest_rate, brokerage_rate, account_type,
    opening_balance, total_deposits, total_withdrawals,
    gross_buy, gross_sell, total_commission,
    closing_balance, closing_balance, accrued_interest, cumulative_interest,
    auth.uid()
  FROM snapshots
  ON CONFLICT (investor_code, eod_date) DO UPDATE SET
    investor_name = EXCLUDED.investor_name,
    rm_id = EXCLUDED.rm_id,
    rm_name = EXCLUDED.rm_name,
    department = EXCLUDED.department,
    interest_rate = EXCLUDED.interest_rate,
    brokerage_rate = EXCLUDED.brokerage_rate,
    account_type = EXCLUDED.account_type,
    opening_balance = EXCLUDED.opening_balance,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    gross_buy = EXCLUDED.gross_buy,
    gross_sell = EXCLUDED.gross_sell,
    total_commission = EXCLUDED.total_commission,
    closing_balance = EXCLUDED.closing_balance,
    ledger_balance = EXCLUDED.ledger_balance,
    accrued_interest = EXCLUDED.accrued_interest,
    cumulative_interest = EXCLUDED.cumulative_interest;

  -- Capture holding snapshots for the EOD date
  DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
  
  WITH universe AS (
    SELECT DISTINCT inv_code FROM (
      SELECT investor_code AS inv_code FROM investors WHERE status = 'Active'
      UNION
      SELECT client_code AS inv_code FROM trade_history WHERE trade_date = p_eod_date
      UNION
      SELECT investor_code AS inv_code FROM deposits_withdrawals WHERE transaction_date = p_eod_date
      UNION
      SELECT investor_code AS inv_code FROM eod_ledger_snapshots WHERE eod_date = p_eod_date - 1
    ) all_codes
  )
  INSERT INTO eod_holding_snapshots (
    investor_code, eod_date, security_code,
    total_qty_saleable, total_qty, avg_cost, total_cost, market_value
  )
  SELECT 
    h.investor_code,
    p_eod_date,
    h.trading_code,
    h.saleable,
    h.total_stock,
    h.avg_cost,
    h.total_cost,
    h.market_value
  FROM holdings h
  WHERE h.investor_code IN (SELECT inv_code FROM universe);

  GET DIAGNOSTICS v_holdings_captured = ROW_COUNT;

  -- Calculate summary statistics
  SELECT 
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_clients_captured, v_total_ledger_balance, v_gross_buy, v_gross_sell,
    v_total_deposits, v_total_withdrawals, v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Count trade files and deposit records
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history WHERE trade_date = p_eod_date;
  
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals WHERE transaction_date = p_eod_date;

  -- Record EOD run history
  INSERT INTO eod_run_history (
    run_date, run_by, run_by_email, clients_captured, total_ledger_balance,
    gross_buy, gross_sell, total_deposits, total_withdrawals, total_commission,
    trade_files_count, deposit_records_count, status
  )
  VALUES (
    p_eod_date, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_clients_captured, v_total_ledger_balance,
    v_gross_buy, v_gross_sell, v_total_deposits, v_total_withdrawals, v_total_commission,
    v_trade_files_count, v_deposit_records_count, 'completed'
  )
  ON CONFLICT (run_date) DO UPDATE SET
    run_at = now(),
    run_by = auth.uid(),
    run_by_email = (SELECT email FROM auth.users WHERE id = auth.uid()),
    clients_captured = v_clients_captured,
    total_ledger_balance = v_total_ledger_balance,
    gross_buy = v_gross_buy,
    gross_sell = v_gross_sell,
    total_deposits = v_total_deposits,
    total_withdrawals = v_total_withdrawals,
    total_commission = v_total_commission,
    trade_files_count = v_trade_files_count,
    deposit_records_count = v_deposit_records_count,
    status = 'completed';

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'holdings_captured', v_holdings_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'total_commission', v_total_commission
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;