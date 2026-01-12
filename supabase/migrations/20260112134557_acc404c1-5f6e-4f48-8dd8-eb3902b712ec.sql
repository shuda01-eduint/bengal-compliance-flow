CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date DATE;
  v_days_processed INTEGER := 0;
  v_total_days INTEGER;
  v_clients_count INTEGER := 0;
  v_expected_clients INTEGER := 0;
  v_user_id UUID;
  v_user_email TEXT;
  v_day_before_start DATE;
  v_earliest_trade_date TEXT;
  v_prev_eod_count INTEGER;
  v_day_deposits NUMERIC;
  v_day_withdrawals NUMERIC;
  v_day_deposit_count INTEGER;
  v_day_trade_files INTEGER;
  v_total_ledger NUMERIC;
BEGIN
  -- Get current user info
  v_user_id := auth.uid();
  v_user_email := auth.jwt() ->> 'email';
  
  -- Security check: require admin role
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin role required to run batch EOD';
  END IF;
  
  -- Validate dates
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Start and end dates are required';
  END IF;
  
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date must be before or equal to end date';
  END IF;
  
  v_total_days := p_end_date - p_start_date + 1;
  v_day_before_start := p_start_date - 1;
  
  -- Get expected client count FIRST (before any temp table operations)
  SELECT COUNT(*) INTO v_expected_clients FROM clients;
  
  -- Check if we need previous day EOD
  SELECT trade_date INTO v_earliest_trade_date
  FROM trade_history
  ORDER BY trade_date ASC
  LIMIT 1;
  
  IF v_earliest_trade_date IS NOT NULL AND 
     to_char(p_start_date, 'YYYYMMDD') > v_earliest_trade_date THEN
    SELECT COUNT(*) INTO v_prev_eod_count
    FROM eod_ledger_snapshots
    WHERE eod_date = v_day_before_start;
    
    IF v_prev_eod_count = 0 THEN
      RAISE EXCEPTION 'No EOD data for %. Please run batch EOD from an earlier date first.', v_day_before_start;
    END IF;
  END IF;
  
  -- Delete existing EOD snapshots from start date onwards
  DELETE FROM eod_ledger_snapshots WHERE eod_date >= p_start_date;
  DELETE FROM eod_run_history WHERE run_date >= p_start_date;
  
  -- Drop and recreate temp tables to ensure clean state
  DROP TABLE IF EXISTS temp_running_balances;
  DROP TABLE IF EXISTS temp_commission_rates;
  
  CREATE TEMP TABLE temp_running_balances (
    investor_code TEXT PRIMARY KEY,
    investor_name TEXT,
    rm_email TEXT,
    ledger_balance NUMERIC DEFAULT 0
  );
  
  -- Initialize running balances from clients table using explicit INSERT
  INSERT INTO temp_running_balances (investor_code, investor_name, rm_email, ledger_balance)
  SELECT c.inv_code, c.investor_name, c.rm_email, COALESCE(c.ledger_balance, 0)
  FROM clients c;
  
  -- Verify we got all clients
  SELECT COUNT(*) INTO v_clients_count FROM temp_running_balances;
  
  -- Raise error if mismatch (critical data integrity check)
  IF v_clients_count != v_expected_clients THEN
    RAISE EXCEPTION 'Client count mismatch! Expected %, got %. EOD aborted.', 
      v_expected_clients, v_clients_count;
  END IF;
  
  -- Override with previous day EOD if exists
  UPDATE temp_running_balances rb
  SET ledger_balance = eod.ledger_balance
  FROM eod_ledger_snapshots eod
  WHERE UPPER(rb.investor_code) = UPPER(eod.investor_code)
    AND eod.eod_date = v_day_before_start;
  
  CREATE TEMP TABLE temp_commission_rates (
    investor_code TEXT PRIMARY KEY,
    brokerage_commission NUMERIC DEFAULT 0
  );
  
  INSERT INTO temp_commission_rates (investor_code, brokerage_commission)
  SELECT UPPER(investor_code), COALESCE(brokerage_commission, 0)
  FROM investors;
  
  -- Process each day
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Get daily deposit/withdrawal totals
    SELECT 
      COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0),
      COUNT(*)
    INTO v_day_deposits, v_day_withdrawals, v_day_deposit_count
    FROM deposits_withdrawals
    WHERE transaction_date = v_current_date;
    
    -- Get trade file count for the day
    SELECT COUNT(DISTINCT file_name) INTO v_day_trade_files
    FROM trade_history
    WHERE trade_date = to_char(v_current_date, 'YYYYMMDD');
    
    -- Apply deposits to running balances
    UPDATE temp_running_balances rb
    SET ledger_balance = rb.ledger_balance + dw.net_amount
    FROM (
      SELECT 
        investor_code,
        SUM(CASE WHEN transaction_type = 'Deposit' THEN amount 
                 WHEN transaction_type = 'Withdrawal' THEN -amount 
                 ELSE 0 END) as net_amount
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ) dw
    WHERE UPPER(rb.investor_code) = UPPER(dw.investor_code);
    
    -- Apply trades to running balances (buy reduces balance, sell increases)
    UPDATE temp_running_balances rb
    SET ledger_balance = rb.ledger_balance + t.net_value
    FROM (
      SELECT 
        client_code,
        SUM(CASE 
          WHEN side = 'S' THEN COALESCE(value, 0) - COALESCE(value, 0) * COALESCE(cr.brokerage_commission, 0) / 100
          WHEN side = 'B' THEN -(COALESCE(value, 0) + COALESCE(value, 0) * COALESCE(cr.brokerage_commission, 0) / 100)
          ELSE 0 
        END) as net_value
      FROM trade_history th
      LEFT JOIN temp_commission_rates cr ON UPPER(th.client_code) = cr.investor_code
      WHERE th.trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY client_code
    ) t
    WHERE UPPER(rb.investor_code) = UPPER(t.client_code);
    
    -- Calculate total ledger balance
    SELECT COALESCE(SUM(ledger_balance), 0) INTO v_total_ledger FROM temp_running_balances;
    
    -- Insert EOD snapshots for all clients
    INSERT INTO eod_ledger_snapshots (
      eod_date, 
      investor_code, 
      investor_name, 
      rm_email, 
      ledger_balance, 
      created_by
    )
    SELECT 
      v_current_date,
      investor_code,
      investor_name,
      rm_email,
      ledger_balance,
      v_user_id
    FROM temp_running_balances;
    
    -- Record run history
    INSERT INTO eod_run_history (
      run_date,
      run_by,
      run_by_email,
      clients_captured,
      total_ledger_balance,
      total_deposits,
      total_withdrawals,
      deposit_records_count,
      trade_files_count,
      status
    ) VALUES (
      v_current_date,
      v_user_id,
      v_user_email,
      v_clients_count,
      v_total_ledger,
      v_day_deposits,
      v_day_withdrawals,
      v_day_deposit_count,
      v_day_trade_files,
      'completed'
    );
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  -- Cleanup temp tables
  DROP TABLE IF EXISTS temp_running_balances;
  DROP TABLE IF EXISTS temp_commission_rates;
  
  RETURN jsonb_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'clients_processed', v_clients_count,
    'expected_clients', v_expected_clients,
    'start_date', p_start_date,
    'end_date', p_end_date
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Cleanup on error
    DROP TABLE IF EXISTS temp_running_balances;
    DROP TABLE IF EXISTS temp_commission_rates;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'days_processed', v_days_processed
    );
END;
$$;