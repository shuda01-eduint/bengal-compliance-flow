-- Fix run_batch_eod function to use correct column names from trade_history table
-- Changes: client_name -> get from investors/clients, buy_sell -> side, total_value -> value, commission -> calculated

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_result JSONB;
  v_existing_run_id UUID;
BEGIN
  -- Check if EOD already exists for this date
  SELECT id INTO v_existing_run_id
  FROM eod_run_history
  WHERE run_date = p_eod_date;
  
  IF v_existing_run_id IS NOT NULL THEN
    IF p_skip_existing THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', format('EOD for %s already exists, skipped', p_eod_date),
        'run_date', p_eod_date
      );
    ELSE
      -- Delete existing data for re-run
      DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
      DELETE FROM eod_run_history WHERE run_date = p_eod_date;
    END IF;
  END IF;

  -- Count distinct trade files for the date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Count deposit/withdrawal records and totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records_count, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Calculate ledger balances for all clients with activity
  WITH day_trades AS (
    SELECT 
      th.client_code,
      COALESCE(i.investor_name, c.investor_name, '') as investor_name,
      c.rm_email,
      SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as total_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as total_sell,
      -- Calculate commission from trade value and investor rate
      SUM(COALESCE(th.value, th.quantity * th.price) * (COALESCE(i.brokerage_commission, 0.4) / 100)) as total_commission
    FROM trade_history th
    LEFT JOIN clients c ON th.client_code = c.inv_code
    LEFT JOIN investors i ON th.client_code = i.investor_code
    WHERE th.trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
    GROUP BY th.client_code, i.investor_name, c.investor_name, c.rm_email
  ),
  day_transactions AS (
    SELECT 
      investor_code as client_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  previous_balance AS (
    SELECT investor_code as client_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = (
      SELECT MAX(eod_date) FROM eod_ledger_snapshots WHERE eod_date < p_eod_date
    )
  ),
  all_clients AS (
    SELECT client_code FROM day_trades
    UNION
    SELECT client_code FROM day_transactions
  ),
  calculated_balances AS (
    SELECT 
      ac.client_code,
      dt.investor_name,
      dt.rm_email,
      COALESCE(pb.ledger_balance, 0) 
        + COALESCE(dtx.deposits, 0) 
        - COALESCE(dtx.withdrawals, 0)
        + COALESCE(dt.total_sell, 0)
        - COALESCE(dt.total_buy, 0)
        - COALESCE(dt.total_commission, 0) as new_balance
    FROM all_clients ac
    LEFT JOIN day_trades dt ON ac.client_code = dt.client_code
    LEFT JOIN day_transactions dtx ON ac.client_code = dtx.client_code
    LEFT JOIN previous_balance pb ON ac.client_code = pb.client_code
  )
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_by)
  SELECT 
    p_eod_date,
    client_code,
    COALESCE(investor_name, ''),
    rm_email,
    new_balance,
    auth.uid()
  FROM calculated_balances;

  -- Get counts and totals
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record the EOD run
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    status
  ) VALUES (
    p_eod_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'run_date', p_eod_date
  );
END;
$$;