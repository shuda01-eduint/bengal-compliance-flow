CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_start_date date,
  p_end_date date
)
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
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    v_prev_date := v_current_date - interval '1 day';
    
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    WITH prev_balances AS (
      SELECT investor_code, ledger_balance, investor_name, rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
    ),
    daily_trades AS (
      SELECT 
        t.client_code as investor_code,
        COALESCE(SUM(CASE WHEN t.side IN ('SELL', 'S') THEN t.value ELSE 0 END), 0) as sell_value,
        COALESCE(SUM(CASE WHEN t.side IN ('BUY', 'B') THEN t.value ELSE 0 END), 0) as buy_value,
        COALESCE(SUM(
          t.value * CASE 
            WHEN COALESCE(t.brokerage_commission, inv.brokerage_commission, 0) >= 0.1 
            THEN COALESCE(t.brokerage_commission, inv.brokerage_commission, 0) / 100.0
            ELSE COALESCE(t.brokerage_commission, inv.brokerage_commission, 0)
          END
        ), 0) as commission
      FROM trade_history t
      LEFT JOIN investors inv ON t.client_code = inv.investor_code
      WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY t.client_code
    ),
    daily_deposits AS (
      SELECT 
        investor_code,
        COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) as deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    all_investors AS (
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
    
    INSERT INTO eod_run_history (run_date, clients_captured, total_ledger_balance, status)
    SELECT 
      v_current_date,
      COUNT(*),
      SUM(ledger_balance),
      'completed'
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date
    ON CONFLICT (run_date) DO UPDATE SET
      clients_captured = EXCLUDED.clients_captured,
      total_ledger_balance = EXCLUDED.total_ledger_balance,
      run_at = now(),
      status = EXCLUDED.status;
    
    v_current_date := v_current_date + interval '1 day';
  END LOOP;
  
  v_result := json_build_object(
    'success', true,
    'dates_processed', v_dates_processed,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_snapshots', v_records_processed,
    'message', format('Processed %s dates from %s to %s', v_dates_processed, p_start_date, p_end_date)
  );
  
  RETURN v_result;
END;
$$;