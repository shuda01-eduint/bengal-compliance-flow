-- Create a SECURITY DEFINER function for batch EOD processing
-- This bypasses RLS to ensure all clients are processed regardless of who runs it

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
  v_user_id UUID;
  v_user_email TEXT;
  v_day_before_start DATE;
  v_earliest_trade_date TEXT;
  v_prev_eod_count INTEGER;
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
  
  -- Check if we need previous day EOD
  SELECT trade_date INTO v_earliest_trade_date
  FROM trade_history
  ORDER BY trade_date ASC
  LIMIT 1;
  
  -- If starting after earliest trade, verify previous day EOD exists
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
  
  -- Create temp tables to hold running balances
  CREATE TEMP TABLE IF NOT EXISTS temp_running_balances (
    investor_code TEXT PRIMARY KEY,
    investor_name TEXT,
    rm_email TEXT,
    ledger_balance NUMERIC DEFAULT 0
  ) ON COMMIT DROP;
  
  TRUNCATE temp_running_balances;
  
  -- Initialize running balances from clients table
  INSERT INTO temp_running_balances (investor_code, investor_name, rm_email, ledger_balance)
  SELECT inv_code, investor_name, rm_email, COALESCE(ledger_balance, 0)
  FROM clients;
  
  -- Get count of clients
  SELECT COUNT(*) INTO v_clients_count FROM temp_running_balances;
  
  -- Override with previous day EOD if exists
  UPDATE temp_running_balances rb
  SET ledger_balance = eod.ledger_balance
  FROM eod_ledger_snapshots eod
  WHERE UPPER(rb.investor_code) = UPPER(eod.investor_code)
    AND eod.eod_date = v_day_before_start;
  
  -- Create temp table for commission rates
  CREATE TEMP TABLE IF NOT EXISTS temp_commission_rates (
    investor_code TEXT PRIMARY KEY,
    brokerage_commission NUMERIC DEFAULT 0
  ) ON COMMIT DROP;
  
  TRUNCATE temp_commission_rates;
  
  INSERT INTO temp_commission_rates (investor_code, brokerage_commission)
  SELECT UPPER(investor_code), COALESCE(brokerage_commission, 0)
  FROM investors;
  
  -- Process each day
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Calculate deposits/withdrawals for the day
    WITH daily_tx AS (
      SELECT 
        UPPER(investor_code) as inv_code,
        SUM(CASE WHEN LOWER(transaction_type) LIKE '%deposit%' THEN amount ELSE 0 END) as deposits,
        SUM(CASE WHEN LOWER(transaction_type) NOT LIKE '%deposit%' THEN amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY UPPER(investor_code)
    ),
    -- Calculate trades for the day
    daily_trades AS (
      SELECT 
        UPPER(th.client_code) as inv_code,
        SUM(CASE 
          WHEN UPPER(th.side) IN ('BUY', 'B') 
          THEN th.value * (1 + COALESCE(cr.brokerage_commission, 0))
          ELSE 0 
        END) as gross_buys,
        SUM(CASE 
          WHEN UPPER(th.side) IN ('SELL', 'S') 
          THEN th.value * (1 - COALESCE(cr.brokerage_commission, 0))
          ELSE 0 
        END) as net_sells
      FROM trade_history th
      LEFT JOIN temp_commission_rates cr ON cr.investor_code = UPPER(th.client_code)
      WHERE th.trade_date = to_char(v_current_date, 'YYYYMMDD')
        AND th.client_code IS NOT NULL
        AND th.value IS NOT NULL
        AND (
          UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
          OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF')
        )
      GROUP BY UPPER(th.client_code)
    ),
    -- Calculate new balances
    new_balances AS (
      SELECT 
        rb.investor_code,
        rb.investor_name,
        rb.rm_email,
        rb.ledger_balance 
          + COALESCE(tx.deposits, 0) 
          - COALESCE(tx.withdrawals, 0)
          + COALESCE(dt.net_sells, 0)
          - COALESCE(dt.gross_buys, 0) as new_balance,
        COALESCE(tx.deposits, 0) as day_deposits,
        COALESCE(tx.withdrawals, 0) as day_withdrawals
      FROM temp_running_balances rb
      LEFT JOIN daily_tx tx ON tx.inv_code = UPPER(rb.investor_code)
      LEFT JOIN daily_trades dt ON dt.inv_code = UPPER(rb.investor_code)
    )
    -- Insert EOD snapshots
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email, created_by)
    SELECT v_current_date, investor_code, investor_name, new_balance, rm_email, v_user_id
    FROM new_balances;
    
    -- Update running balances for next day
    UPDATE temp_running_balances rb
    SET ledger_balance = nb.new_balance
    FROM (
      SELECT 
        rb2.investor_code,
        rb2.ledger_balance 
          + COALESCE(tx.deposits, 0) 
          - COALESCE(tx.withdrawals, 0)
          + COALESCE(dt.net_sells, 0)
          - COALESCE(dt.gross_buys, 0) as new_balance
      FROM temp_running_balances rb2
      LEFT JOIN (
        SELECT UPPER(investor_code) as inv_code,
          SUM(CASE WHEN LOWER(transaction_type) LIKE '%deposit%' THEN amount ELSE 0 END) as deposits,
          SUM(CASE WHEN LOWER(transaction_type) NOT LIKE '%deposit%' THEN amount ELSE 0 END) as withdrawals
        FROM deposits_withdrawals WHERE transaction_date = v_current_date
        GROUP BY UPPER(investor_code)
      ) tx ON tx.inv_code = UPPER(rb2.investor_code)
      LEFT JOIN (
        SELECT UPPER(th.client_code) as inv_code,
          SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN th.value * (1 + COALESCE(cr.brokerage_commission, 0)) ELSE 0 END) as gross_buys,
          SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN th.value * (1 - COALESCE(cr.brokerage_commission, 0)) ELSE 0 END) as net_sells
        FROM trade_history th
        LEFT JOIN temp_commission_rates cr ON cr.investor_code = UPPER(th.client_code)
        WHERE th.trade_date = to_char(v_current_date, 'YYYYMMDD')
          AND th.client_code IS NOT NULL AND th.value IS NOT NULL
          AND (UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF') OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF'))
        GROUP BY UPPER(th.client_code)
      ) dt ON dt.inv_code = UPPER(rb2.investor_code)
    ) nb
    WHERE UPPER(rb.investor_code) = UPPER(nb.investor_code);
    
    -- Record run history
    INSERT INTO eod_run_history (
      run_date, run_by, run_by_email, clients_captured, 
      total_ledger_balance, status,
      total_deposits, total_withdrawals, deposit_records_count, trade_files_count
    )
    SELECT 
      v_current_date,
      v_user_id,
      v_user_email,
      v_clients_count,
      COALESCE(SUM(ledger_balance), 0),
      'completed',
      COALESCE((SELECT SUM(amount) FROM deposits_withdrawals WHERE transaction_date = v_current_date AND LOWER(transaction_type) LIKE '%deposit%'), 0),
      COALESCE((SELECT SUM(amount) FROM deposits_withdrawals WHERE transaction_date = v_current_date AND LOWER(transaction_type) NOT LIKE '%deposit%'), 0),
      (SELECT COUNT(*) FROM deposits_withdrawals WHERE transaction_date = v_current_date),
      (SELECT CASE WHEN EXISTS (SELECT 1 FROM trade_history WHERE trade_date = to_char(v_current_date, 'YYYYMMDD')) THEN 1 ELSE 0 END)
    FROM temp_running_balances;
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'clients_processed', v_clients_count,
    'start_date', p_start_date,
    'end_date', p_end_date
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'days_processed', v_days_processed
    );
END;
$$;

-- Add unique constraint for upsert if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'eod_ledger_snapshots_eod_date_investor_code_key'
  ) THEN
    ALTER TABLE eod_ledger_snapshots 
    ADD CONSTRAINT eod_ledger_snapshots_eod_date_investor_code_key 
    UNIQUE (eod_date, investor_code);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;