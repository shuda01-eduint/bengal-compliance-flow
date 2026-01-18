CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_start_date date,
  p_end_date date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_current_date date;
  v_processed_count integer := 0;
  v_total_clients integer := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_deposit_records integer := 0;
  v_trade_files integer := 0;
  v_result json;
BEGIN
  -- Loop through each date in range
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Delete existing snapshots for this date
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Get previous day's closing balances or use opening balances
    WITH previous_balances AS (
      SELECT 
        investor_code,
        investor_name,
        ledger_balance,
        rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_current_date - 1
    ),
    opening_balances AS (
      SELECT 
        i.investor_code,
        i.investor_name,
        COALESCE(c.ledger_balance, 0) as ledger_balance,
        COALESCE(
          (SELECT rm_email FROM investor_rm_assignments WHERE investor_code = i.investor_code LIMIT 1),
          c.rm_email
        ) as rm_email
      FROM investors i
      LEFT JOIN clients c ON i.investor_code = c.inv_code
    ),
    base_balances AS (
      SELECT * FROM previous_balances
      UNION ALL
      SELECT ob.* FROM opening_balances ob
      WHERE NOT EXISTS (SELECT 1 FROM previous_balances pb WHERE pb.investor_code = ob.investor_code)
    ),
    day_trades AS (
      SELECT 
        client_code,
        SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(value, 0) + COALESCE(brokerage_commission, 0) ELSE 0 END) as total_buy,
        SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(value, 0) - COALESCE(brokerage_commission, 0) ELSE 0 END) as total_sell
      FROM trade_history
      WHERE trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY client_code
    ),
    day_deposits AS (
      SELECT 
        investor_code,
        SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) as deposits,
        SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    calculated_balances AS (
      SELECT 
        bb.investor_code,
        bb.investor_name,
        bb.ledger_balance 
          + COALESCE(dd.deposits, 0) 
          - COALESCE(dd.withdrawals, 0)
          - COALESCE(dt.total_buy, 0)
          + COALESCE(dt.total_sell, 0) as new_balance,
        bb.rm_email
      FROM base_balances bb
      LEFT JOIN day_trades dt ON bb.investor_code = dt.client_code
      LEFT JOIN day_deposits dd ON bb.investor_code = dd.investor_code
    )
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email, created_by)
    SELECT 
      v_current_date,
      investor_code,
      investor_name,
      new_balance,
      rm_email,
      auth.uid()
    FROM calculated_balances;
    
    -- Get stats for this date
    SELECT 
      COUNT(*),
      COALESCE(SUM(ledger_balance), 0)
    INTO v_total_clients, v_total_ledger
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date;
    
    -- Get deposit/withdrawal stats
    SELECT 
      COUNT(*),
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0)
    INTO v_deposit_records, v_total_deposits, v_total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = v_current_date;
    
    -- Get trade file count
    SELECT COUNT(DISTINCT file_name)
    INTO v_trade_files
    FROM trade_history
    WHERE trade_date = to_char(v_current_date, 'YYYYMMDD');
    
    -- Record the run in history (upsert)
    INSERT INTO eod_run_history (
      run_date,
      run_at,
      run_by,
      run_by_email,
      status,
      clients_captured,
      total_ledger_balance,
      total_deposits,
      total_withdrawals,
      deposit_records_count,
      trade_files_count
    ) VALUES (
      v_current_date,
      now(),
      auth.uid(),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'completed',
      v_total_clients,
      v_total_ledger,
      v_total_deposits,
      v_total_withdrawals,
      v_deposit_records,
      v_trade_files
    )
    ON CONFLICT (run_date) DO UPDATE SET
      run_at = now(),
      run_by = auth.uid(),
      run_by_email = (SELECT email FROM auth.users WHERE id = auth.uid()),
      status = 'completed',
      clients_captured = EXCLUDED.clients_captured,
      total_ledger_balance = EXCLUDED.total_ledger_balance,
      total_deposits = EXCLUDED.total_deposits,
      total_withdrawals = EXCLUDED.total_withdrawals,
      deposit_records_count = EXCLUDED.deposit_records_count,
      trade_files_count = EXCLUDED.trade_files_count;
    
    v_processed_count := v_processed_count + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  -- Return summary
  v_result := json_build_object(
    'success', true,
    'days_processed', v_processed_count,
    'last_date', p_end_date,
    'clients_captured', v_total_clients,
    'total_ledger_balance', v_total_ledger
  );
  
  RETURN v_result;
END;
$$;