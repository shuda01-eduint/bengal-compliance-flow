-- Fix run_batch_eod function: correct date type comparisons
DROP FUNCTION IF EXISTS public.run_batch_eod(DATE, DATE);

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date DATE, p_end_date DATE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date DATE;
  v_days_processed INT := 0;
  v_total_clients INT := 0;
  v_result JSON;
BEGIN
  -- Validate date range
  IF p_start_date > p_end_date THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Start date must be before or equal to end date'
    );
  END IF;

  -- Process each day in the range
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Delete existing snapshots for this date (to allow re-running)
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Insert EOD snapshots for all clients
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      ledger_balance,
      rm_email,
      created_by
    )
    SELECT 
      v_current_date,
      client_code,
      investor_name,
      closing_balance,
      rm_email,
      auth.uid()
    FROM (
      SELECT 
        c.inv_code AS client_code,
        c.investor_name,
        c.rm_email,
        -- Calculate closing balance: opening + deposits - withdrawals + sells - buys (with commission)
        COALESCE(
          -- Get opening balance from previous day's EOD snapshot
          (SELECT ledger_balance FROM eod_ledger_snapshots 
           WHERE investor_code = c.inv_code 
           AND eod_date = v_current_date - INTERVAL '1 day'
           LIMIT 1),
          -- Fall back to balances_raw for the most recent date before current (as_of_date is DATE)
          (SELECT ledger_balance FROM balances_raw 
           WHERE investor_code = c.inv_code 
           AND as_of_date <= v_current_date
           ORDER BY as_of_date DESC
           LIMIT 1),
          -- Fall back to clients table
          c.ledger_balance
        )
        -- Add deposits (transaction_date is DATE)
        + COALESCE(
          (SELECT SUM(amount) FROM deposits_withdrawals 
           WHERE investor_code = c.inv_code 
           AND transaction_date = v_current_date
           AND transaction_type = 'Deposit'),
          0
        )
        -- Subtract withdrawals (transaction_date is DATE)
        - COALESCE(
          (SELECT SUM(amount) FROM deposits_withdrawals 
           WHERE investor_code = c.inv_code 
           AND transaction_date = v_current_date
           AND transaction_type = 'Withdrawal'),
          0
        )
        -- Add/subtract trades with commission (trade_date is TEXT)
        + COALESCE(
          (SELECT SUM(
            CASE 
              WHEN t.side = 'SELL' THEN COALESCE(t.value, 0) - COALESCE(t.value, 0) * COALESCE(cr.brokerage_commission, 0)
              WHEN t.side = 'BUY' THEN -(COALESCE(t.value, 0) + COALESCE(t.value, 0) * COALESCE(cr.brokerage_commission, 0))
              ELSE 0
            END
          )
          FROM trade_history t
          LEFT JOIN investors cr ON t.client_code = cr.investor_code
          WHERE t.client_code = c.inv_code 
          AND t.trade_date = v_current_date::text),
          0
        ) AS closing_balance
      FROM clients c
      WHERE c.status = 'Active'
    ) AS daily_balances;
    
    -- Count clients processed
    v_total_clients := v_total_clients + (
      SELECT COUNT(*) FROM eod_ledger_snapshots WHERE eod_date = v_current_date
    );
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Record the EOD run in history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    status,
    clients_captured,
    total_ledger_balance,
    notes
  )
  SELECT 
    p_end_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'completed',
    (SELECT COUNT(*) FROM eod_ledger_snapshots WHERE eod_date = p_end_date),
    (SELECT COALESCE(SUM(ledger_balance), 0) FROM eod_ledger_snapshots WHERE eod_date = p_end_date),
    format('Batch EOD run from %s to %s: %s days processed', p_start_date, p_end_date, v_days_processed);
  
  RETURN json_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'total_snapshots', v_total_clients,
    'start_date', p_start_date,
    'end_date', p_end_date
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'days_processed', v_days_processed
  );
END;
$$;