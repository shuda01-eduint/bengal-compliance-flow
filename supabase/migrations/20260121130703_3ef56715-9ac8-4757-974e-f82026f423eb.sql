-- Fix run_batch_eod function to use file_name instead of upload_batch_id
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured int := 0;
  v_total_ledger numeric := 0;
  v_trade_files int := 0;
  v_deposit_records int := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_previous_date date;
  v_has_previous_eod boolean := false;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing EOD data for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Find the previous EOD date
  SELECT MAX(eod_date) INTO v_previous_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  v_has_previous_eod := v_previous_date IS NOT NULL;

  -- Count trade files for this date (FIXED: use file_name instead of upload_batch_id)
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Count deposit records and sums
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Calculate EOD snapshots with commission from investors table
  WITH day_trades AS (
    SELECT 
      th.client_code,
      th.client_name,
      c.rm_email,
      SUM(CASE WHEN th.buy_sell = 'B' THEN th.total_value ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.buy_sell = 'S' THEN th.total_value ELSE 0 END) as total_sell,
      SUM(th.commission) as total_commission,
      -- Use investor-specific commission rate, default to 0.4% if not set
      (COALESCE(i.brokerage_commission, 0.4) / 100) as commission_rate
    FROM trade_history th
    LEFT JOIN clients c ON th.client_code = c.inv_code
    LEFT JOIN investors i ON th.client_code = i.investor_code
    WHERE th.trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
    GROUP BY th.client_code, th.client_name, c.rm_email, i.brokerage_commission
  ),
  day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  previous_balances AS (
    SELECT investor_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_previous_date
  ),
  calculated_balances AS (
    SELECT 
      COALESCE(dt.client_code, dd.investor_code, pb.investor_code) as investor_code,
      COALESCE(dt.client_name, '') as investor_name,
      COALESCE(dt.rm_email, '') as rm_email,
      COALESCE(pb.ledger_balance, 0) as prev_balance,
      COALESCE(dt.total_buy, 0) as total_buy,
      COALESCE(dt.total_sell, 0) as total_sell,
      COALESCE(dt.total_commission, 0) as trade_commission,
      COALESCE(dt.commission_rate, 0.004) as commission_rate,
      COALESCE(dd.deposits, 0) as deposits,
      COALESCE(dd.withdrawals, 0) as withdrawals,
      -- Calculate new balance: prev + sell - buy - commission + deposits - withdrawals
      COALESCE(pb.ledger_balance, 0) 
        + COALESCE(dt.total_sell, 0) 
        - COALESCE(dt.total_buy, 0) 
        - COALESCE(dt.total_commission, 0)
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0) as new_balance
    FROM day_trades dt
    FULL OUTER JOIN day_deposits dd ON dt.client_code = dd.investor_code
    FULL OUTER JOIN previous_balances pb ON COALESCE(dt.client_code, dd.investor_code) = pb.investor_code
    WHERE dt.client_code IS NOT NULL OR dd.investor_code IS NOT NULL OR pb.investor_code IS NOT NULL
  )
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_by)
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    rm_email,
    new_balance,
    auth.uid()
  FROM calculated_balances
  WHERE investor_code IS NOT NULL;

  -- Get counts and totals
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record the EOD run in history
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
    v_total_ledger,
    v_trade_files,
    v_deposit_records,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger,
    'trade_files_count', v_trade_files,
    'deposit_records_count', v_deposit_records,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'has_previous_eod', v_has_previous_eod,
    'previous_eod_date', v_previous_date
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'eod_date', p_eod_date
  );
END;
$$;