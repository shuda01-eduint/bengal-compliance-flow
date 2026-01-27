
-- Fix run_batch_eod to handle trade_date as TEXT (YYYYMMDD format)
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_user_id uuid;
  v_user_email text;
  v_run_id uuid;
  v_prev_date date;
  v_eod_date_text text;  -- For trade_history comparison
BEGIN
  -- Check admin role
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access denied. Admin role required.',
      'sqlstate', 'P0001'
    );
  END IF;

  -- Get user info
  v_user_id := auth.uid();
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  
  -- Calculate previous date for opening balance lookup
  v_prev_date := p_eod_date - interval '1 day';
  
  -- Convert EOD date to YYYYMMDD format for trade_history comparison
  v_eod_date_text := to_char(p_eod_date, 'YYYYMMDD');

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing snapshots for this date (re-run scenario)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Main EOD calculation with CTEs
  WITH 
  -- Universe: all investors who should have EOD snapshots
  universe AS (
    SELECT DISTINCT investor_code FROM (
      -- From trades on this date
      SELECT client_code AS investor_code FROM trade_history WHERE trade_date = v_eod_date_text
      UNION
      -- From deposits/withdrawals on this date (backwards compatibility)
      SELECT investor_code FROM deposits_withdrawals WHERE transaction_date = p_eod_date
      UNION
      -- From previous day snapshots
      SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
      UNION
      -- From investors master
      SELECT investor_code FROM investors WHERE status = 'Active'
    ) u
  ),
  
  -- Previous day closing balances
  prev_balances AS (
    SELECT 
      investor_code,
      closing_balance,
      cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  
  -- Daily deposits/withdrawals from trade_history (new source)
  daily_deposits AS (
    SELECT 
      client_code AS investor_code,
      COALESCE(MAX(total_deposits), 0) AS deposits,
      COALESCE(MAX(total_withdrawals), 0) AS withdrawals,
      MAX(ledger_balance_snapshot) AS ledger_snapshot
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  
  -- Fallback: deposits/withdrawals from legacy table (for historical data)
  legacy_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) AS deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  -- Trade aggregates
  trade_agg AS (
    SELECT 
      client_code AS investor_code,
      SUM(CASE WHEN side = 'B' THEN executed_value ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN side = 'S' THEN executed_value ELSE 0 END) AS gross_sell,
      SUM(COALESCE(commission, 0)) AS total_commission
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  
  -- Investor metadata
  investor_meta AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.interest_rate,
      i.brokerage_commission,
      COALESCE(i.rm_id, ira.rm_id) AS rm_id,
      COALESCE(i.rm_name, ira.rm_name) AS rm_name,
      COALESCE(i.department, e.department) AS department,
      COALESCE(
        (SELECT email FROM employees WHERE employee_id = i.rm_id LIMIT 1),
        ira.rm_email
      ) AS rm_email
    FROM investors i
    LEFT JOIN LATERAL (
      SELECT rm_email, rm_name, 
             (SELECT employee_id FROM employees WHERE LOWER(email) = LOWER(ira2.rm_email) LIMIT 1) AS rm_id
      FROM investor_rm_assignments ira2
      WHERE ira2.investor_code = i.investor_code
      ORDER BY ira2.percentage DESC
      LIMIT 1
    ) ira ON true
    LEFT JOIN employees e ON e.employee_id = i.rm_id
  ),
  
  -- Calculate snapshots
  snapshots AS (
    SELECT 
      u.investor_code,
      p_eod_date AS eod_date,
      COALESCE(pb.closing_balance, 0) AS opening_balance,
      -- Use trade_history deposits first, fallback to legacy
      COALESCE(dd.deposits, ld.deposits, 0) AS total_deposits,
      COALESCE(dd.withdrawals, ld.withdrawals, 0) AS total_withdrawals,
      COALESCE(ta.gross_buy, 0) AS gross_buy,
      COALESCE(ta.gross_sell, 0) AS gross_sell,
      COALESCE(ta.total_commission, 0) AS total_commission,
      -- Closing balance formula
      COALESCE(pb.closing_balance, 0) 
        + COALESCE(dd.deposits, ld.deposits, 0) 
        - COALESCE(dd.withdrawals, ld.withdrawals, 0)
        + COALESCE(ta.gross_sell, 0)
        - COALESCE(ta.gross_buy, 0)
        - COALESCE(ta.total_commission, 0) AS closing_balance,
      -- Net trade value
      COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) AS net_trade_value,
      -- Metadata
      im.investor_name,
      im.account_type,
      im.rm_id,
      im.rm_name,
      im.rm_email,
      im.department,
      im.interest_rate,
      im.brokerage_commission AS brokerage_rate,
      -- Interest calculation
      COALESCE(pb.cumulative_interest, 0) AS prev_cumulative_interest,
      -- Ledger balance snapshot from trade file
      dd.ledger_snapshot AS ledger_balance_snapshot
    FROM universe u
    LEFT JOIN prev_balances pb ON pb.investor_code = u.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = u.investor_code
    LEFT JOIN legacy_deposits ld ON ld.investor_code = u.investor_code
    LEFT JOIN trade_agg ta ON ta.investor_code = u.investor_code
    LEFT JOIN investor_meta im ON im.investor_code = u.investor_code
  )
  
  -- Insert snapshots
  INSERT INTO eod_ledger_snapshots (
    investor_code, eod_date, opening_balance, closing_balance,
    total_deposits, total_withdrawals, gross_buy, gross_sell,
    total_commission, net_trade_value, ledger_balance,
    investor_name, account_type, rm_id, rm_name, rm_email, department,
    interest_rate, brokerage_rate, cumulative_interest, ledger_balance_snapshot,
    created_by
  )
  SELECT 
    investor_code, eod_date, opening_balance, closing_balance,
    total_deposits, total_withdrawals, gross_buy, gross_sell,
    total_commission, net_trade_value, closing_balance AS ledger_balance,
    investor_name, account_type, rm_id, rm_name, rm_email, department,
    interest_rate, brokerage_rate, prev_cumulative_interest, 
    COALESCE(ledger_balance_snapshot, 0),
    v_user_id
  FROM snapshots
  ON CONFLICT (investor_code, eod_date) DO UPDATE SET
    opening_balance = EXCLUDED.opening_balance,
    closing_balance = EXCLUDED.closing_balance,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    gross_buy = EXCLUDED.gross_buy,
    gross_sell = EXCLUDED.gross_sell,
    total_commission = EXCLUDED.total_commission,
    net_trade_value = EXCLUDED.net_trade_value,
    ledger_balance = EXCLUDED.ledger_balance,
    investor_name = EXCLUDED.investor_name,
    account_type = EXCLUDED.account_type,
    rm_id = EXCLUDED.rm_id,
    rm_name = EXCLUDED.rm_name,
    rm_email = EXCLUDED.rm_email,
    department = EXCLUDED.department,
    interest_rate = EXCLUDED.interest_rate,
    brokerage_rate = EXCLUDED.brokerage_rate,
    cumulative_interest = EXCLUDED.cumulative_interest,
    ledger_balance_snapshot = EXCLUDED.ledger_balance_snapshot,
    created_by = EXCLUDED.created_by;

  -- Capture holdings snapshot
  INSERT INTO eod_holding_snapshots (
    investor_code, eod_date, security_code, 
    total_qty, total_qty_saleable, avg_cost, total_cost, market_value
  )
  SELECT 
    investor_code, p_eod_date, trading_code,
    total_stock, saleable, avg_cost, total_cost, market_value
  FROM holdings
  ON CONFLICT (investor_code, eod_date, security_code) DO UPDATE SET
    total_qty = EXCLUDED.total_qty,
    total_qty_saleable = EXCLUDED.total_qty_saleable,
    avg_cost = EXCLUDED.avg_cost,
    total_cost = EXCLUDED.total_cost,
    market_value = EXCLUDED.market_value;

  -- Get summary stats
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

  -- Count trade files and deposit records
  SELECT COUNT(DISTINCT upload_batch_id) INTO v_trade_files_count
  FROM trade_history WHERE trade_date = v_eod_date_text;
  
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM trade_history WHERE trade_date = v_eod_date_text AND (total_deposits > 0 OR total_withdrawals > 0);

  -- Log the run
  INSERT INTO eod_run_history (
    run_date, run_by, run_by_email, clients_captured, total_ledger_balance,
    total_deposits, total_withdrawals, gross_buy, gross_sell, total_commission,
    trade_files_count, deposit_records_count, status
  ) VALUES (
    p_eod_date, v_user_id, v_user_email, v_clients_captured, v_total_ledger_balance,
    v_total_deposits, v_total_withdrawals, v_gross_buy, v_gross_sell, v_total_commission,
    v_trade_files_count, v_deposit_records_count, 'completed'
  )
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
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
