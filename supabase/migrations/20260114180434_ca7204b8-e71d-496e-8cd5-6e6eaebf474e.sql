-- Fix trade date format mismatch in run_batch_eod function
-- The trade_history.trade_date is stored as 'YYYYMMDD' (e.g., '20251217')
-- but the function was comparing with 'YYYY-MM-DD' format

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date date, p_end_date date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date date;
  v_days_processed int := 0;
  v_total_snapshots int := 0;
  v_day_snapshots int;
BEGIN
  -- Loop through each date
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Delete existing snapshots for this date
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Insert new snapshots using set-based operations
    WITH latest_balances AS (
      -- Get latest balance for each investor from balances_raw
      SELECT DISTINCT ON (investor_code)
        investor_code,
        ledger_balance,
        rm_email
      FROM balances_raw
      WHERE as_of_date <= v_current_date
      ORDER BY investor_code, as_of_date DESC
    ),
    prev_eod AS (
      -- Get previous day's EOD snapshot if exists
      SELECT investor_code, ledger_balance, rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_current_date - 1
    ),
    daily_trades AS (
      -- Get trade sums for this specific date
      -- FIX: Use YYYYMMDD format to match trade_history.trade_date storage format
      SELECT 
        client_code,
        SUM(CASE WHEN side = 'B' THEN COALESCE(value, 0) + COALESCE(brokerage_commission, 0) ELSE 0 END) as buy_value,
        SUM(CASE WHEN side = 'S' THEN COALESCE(value, 0) - COALESCE(brokerage_commission, 0) ELSE 0 END) as sell_value
      FROM trade_history t
      WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY client_code
    ),
    daily_deposits AS (
      -- Get deposits/withdrawals for this date
      SELECT 
        investor_code,
        SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
        SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    all_investors AS (
      -- Union of all investors from various sources
      SELECT investor_code FROM latest_balances
      UNION
      SELECT investor_code FROM prev_eod
      UNION
      SELECT client_code FROM daily_trades
      UNION
      SELECT investor_code FROM daily_deposits
      UNION
      SELECT inv_code FROM clients
    ),
    calculated_balances AS (
      SELECT 
        ai.investor_code,
        COALESCE(c.investor_name, i.investor_name) as investor_name,
        COALESCE(pe.rm_email, lb.rm_email, c.rm_email) as rm_email,
        -- Calculate: previous balance + deposits - withdrawals - buys + sells
        COALESCE(pe.ledger_balance, lb.ledger_balance, c.ledger_balance, 0)
          + COALESCE(dd.deposits, 0)
          - COALESCE(dd.withdrawals, 0)
          - COALESCE(dt.buy_value, 0)
          + COALESCE(dt.sell_value, 0) as calculated_ledger
      FROM all_investors ai
      LEFT JOIN prev_eod pe ON pe.investor_code = ai.investor_code
      LEFT JOIN latest_balances lb ON lb.investor_code = ai.investor_code
      LEFT JOIN clients c ON c.inv_code = ai.investor_code
      LEFT JOIN investors i ON i.investor_code = ai.investor_code
      LEFT JOIN daily_trades dt ON dt.client_code = ai.investor_code
      LEFT JOIN daily_deposits dd ON dd.investor_code = ai.investor_code
    )
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
    SELECT 
      v_current_date,
      investor_code,
      investor_name,
      calculated_ledger,
      rm_email
    FROM calculated_balances;
    
    GET DIAGNOSTICS v_day_snapshots = ROW_COUNT;
    v_total_snapshots := v_total_snapshots + v_day_snapshots;
    
    -- Record in history
    INSERT INTO eod_run_history (run_date, status, clients_captured, total_ledger_balance, run_by_email)
    SELECT 
      v_current_date,
      'completed',
      COUNT(*),
      COALESCE(SUM(ledger_balance), 0),
      current_setting('request.jwt.claims', true)::json->>'email'
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date
    ON CONFLICT (run_date) DO UPDATE SET
      status = 'completed',
      clients_captured = EXCLUDED.clients_captured,
      total_ledger_balance = EXCLUDED.total_ledger_balance,
      run_at = now(),
      run_by_email = EXCLUDED.run_by_email;
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN json_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'total_snapshots', v_total_snapshots,
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
$function$;