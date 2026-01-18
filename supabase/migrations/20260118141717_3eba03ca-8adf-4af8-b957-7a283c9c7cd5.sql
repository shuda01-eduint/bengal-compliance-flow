-- Fix the run_batch_eod function to use correct date format for trade_date comparison
-- trade_history.trade_date is stored as 'YYYYMMDD' (e.g., '20260113')
-- but v_current_date::text produces 'YYYY-MM-DD' (e.g., '2026-01-13')

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date date, p_end_date date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date;
  v_prev_date date;
  v_records_processed int := 0;
  v_dates_processed int := 0;
  v_result json;
BEGIN
  -- Loop through each date in the range
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    v_prev_date := v_current_date - interval '1 day';
    
    -- Delete existing snapshots for this date (to allow re-run)
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Insert new snapshots
    -- Start with previous day's closing balance, then apply today's trades and deposits/withdrawals
    WITH prev_balances AS (
      -- Get previous day's closing balances
      SELECT investor_code, ledger_balance, investor_name, rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
    ),
    daily_trades AS (
      -- Get today's trade activity using correct date format (YYYYMMDD)
      SELECT 
        t.client_code as investor_code,
        COALESCE(SUM(CASE WHEN t.side IN ('SELL', 'S') THEN t.value ELSE 0 END), 0) as sell_value,
        COALESCE(SUM(CASE WHEN t.side IN ('BUY', 'B') THEN t.value ELSE 0 END), 0) as buy_value,
        COALESCE(SUM(t.brokerage_commission), 0) as commission
      FROM trade_history t
      WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY t.client_code
    ),
    daily_deposits AS (
      -- Get today's deposits and withdrawals
      SELECT 
        investor_code,
        COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) as deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    all_investors AS (
      -- Union of all investor codes that have activity or previous balance
      SELECT investor_code FROM prev_balances
      UNION
      SELECT investor_code FROM daily_trades
      UNION
      SELECT investor_code FROM daily_deposits
    )
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, ledger_balance, investor_name, rm_email)
    SELECT 
      v_current_date,
      ai.investor_code,
      -- Calculate new balance: prev_balance + deposits - withdrawals + sell_value - buy_value - commission
      COALESCE(pb.ledger_balance, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0)
        + COALESCE(dt.sell_value, 0) 
        - COALESCE(dt.buy_value, 0) 
        - COALESCE(dt.commission, 0) as ledger_balance,
      COALESCE(pb.investor_name, i.investor_name),
      COALESCE(pb.rm_email, ira.rm_email)
    FROM all_investors ai
    LEFT JOIN prev_balances pb ON pb.investor_code = ai.investor_code
    LEFT JOIN daily_trades dt ON dt.investor_code = ai.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = ai.investor_code
    LEFT JOIN investors i ON i.investor_code = ai.investor_code
    LEFT JOIN investor_rm_assignments ira ON ira.investor_code = ai.investor_code;
    
    GET DIAGNOSTICS v_records_processed = ROW_COUNT;
    v_dates_processed := v_dates_processed + 1;
    
    -- Move to next date
    v_current_date := v_current_date + interval '1 day';
  END LOOP;
  
  -- Return summary
  v_result := json_build_object(
    'success', true,
    'dates_processed', v_dates_processed,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'message', format('Processed %s dates from %s to %s', v_dates_processed, p_start_date, p_end_date)
  );
  
  RETURN v_result;
END;
$$;