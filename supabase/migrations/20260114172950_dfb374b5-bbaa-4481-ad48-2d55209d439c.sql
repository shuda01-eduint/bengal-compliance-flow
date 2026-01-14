-- Rewrite run_batch_eod with set-based operations to fix statement timeout
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
  v_day_count INT;
BEGIN
  -- Validate date range
  IF p_start_date > p_end_date THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Start date must be before or equal to end date'
    );
  END IF;

  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Delete existing snapshots for this date
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Use CTEs to pre-aggregate all data in a single pass (no correlated subqueries)
    WITH 
    -- Pre-aggregate deposits for ALL clients on this date
    daily_deposits AS (
      SELECT investor_code, SUM(amount) as total_deposit
      FROM deposits_withdrawals 
      WHERE transaction_date = v_current_date AND transaction_type = 'Deposit'
      GROUP BY investor_code
    ),
    -- Pre-aggregate withdrawals for ALL clients on this date
    daily_withdrawals AS (
      SELECT investor_code, SUM(amount) as total_withdrawal
      FROM deposits_withdrawals 
      WHERE transaction_date = v_current_date AND transaction_type = 'Withdrawal'
      GROUP BY investor_code
    ),
    -- Pre-aggregate trades for ALL clients on this date (trade_date is TEXT)
    daily_trades AS (
      SELECT 
        t.client_code,
        SUM(
          CASE 
            WHEN t.side = 'SELL' THEN COALESCE(t.value, 0) - COALESCE(t.value, 0) * COALESCE(inv.brokerage_commission, 0)
            WHEN t.side = 'BUY' THEN -(COALESCE(t.value, 0) + COALESCE(t.value, 0) * COALESCE(inv.brokerage_commission, 0))
            ELSE 0
          END
        ) as trade_impact
      FROM trade_history t
      LEFT JOIN investors inv ON t.client_code = inv.investor_code
      WHERE t.trade_date = v_current_date::text
      GROUP BY t.client_code
    ),
    -- Get previous day's EOD snapshots for ALL clients (single scan)
    prev_eod AS (
      SELECT investor_code, ledger_balance 
      FROM eod_ledger_snapshots 
      WHERE eod_date = v_current_date - INTERVAL '1 day'
    ),
    -- Get latest balances_raw for clients without previous EOD (single scan)
    latest_balances AS (
      SELECT DISTINCT ON (investor_code) 
        investor_code, ledger_balance
      FROM balances_raw 
      WHERE as_of_date <= v_current_date
      ORDER BY investor_code, as_of_date DESC
    )
    -- Single INSERT with LEFT JOINs instead of correlated subqueries
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email, created_by)
    SELECT 
      v_current_date,
      c.inv_code,
      c.investor_name,
      COALESCE(pe.ledger_balance, lb.ledger_balance, c.ledger_balance)
        + COALESCE(dd.total_deposit, 0)
        - COALESCE(dw.total_withdrawal, 0)
        + COALESCE(dt.trade_impact, 0),
      c.rm_email,
      auth.uid()
    FROM clients c
    LEFT JOIN prev_eod pe ON pe.investor_code = c.inv_code
    LEFT JOIN latest_balances lb ON lb.investor_code = c.inv_code AND pe.investor_code IS NULL
    LEFT JOIN daily_deposits dd ON dd.investor_code = c.inv_code
    LEFT JOIN daily_withdrawals dw ON dw.investor_code = c.inv_code
    LEFT JOIN daily_trades dt ON dt.client_code = c.inv_code
    WHERE c.status = 'Active';
    
    -- Count clients processed for this day
    GET DIAGNOSTICS v_day_count = ROW_COUNT;
    v_total_clients := v_total_clients + v_day_count;
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
    format('Batch EOD run from %s to %s: %s days, %s total snapshots', p_start_date, p_end_date, v_days_processed, v_total_clients);
  
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