-- Fix run_batch_eod function to handle TEXT trade_date column
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_existing_run_id uuid;
  v_run_id uuid;
  v_user_email text;
  v_trade_date_str text;
BEGIN
  -- Convert date to YYYYMMDD text format for trade_history comparison
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');

  -- Check if EOD already exists for this date
  SELECT id INTO v_existing_run_id
  FROM eod_run_history
  WHERE run_date = p_eod_date
  LIMIT 1;

  -- If skip_existing is true and we have an existing run, return early
  IF p_skip_existing AND v_existing_run_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date',
      'run_id', v_existing_run_id
    );
  END IF;

  -- Get user email for audit
  v_user_email := auth.jwt() ->> 'email';

  -- Delete existing EOD data for this date if re-running
  IF v_existing_run_id IS NOT NULL THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Calculate gross buy and gross sell from trade_history (using TEXT date format)
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(side) = 'B' OR UPPER(side) = 'BUY' THEN COALESCE(value, quantity * price, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'S' OR UPPER(side) = 'SELL' THEN COALESCE(value, quantity * price, 0) ELSE 0 END), 0)
  INTO v_gross_buy, v_gross_sell
  FROM trade_history
  WHERE trade_date = v_trade_date_str
    AND (UPPER(status) IN ('FILL', 'PF', 'FILLED', 'PARTIAL') OR UPPER(fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL') OR status IS NULL);

  -- Count distinct trade files for this date (using TEXT date format)
  SELECT COUNT(DISTINCT file_name)
  INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_trade_date_str
    AND file_name IS NOT NULL;

  -- Calculate deposits and withdrawals (transaction_date is DATE type)
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' OR UPPER(transaction_type) = 'D' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' OR UPPER(transaction_type) = 'W' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records_count, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Capture ledger snapshots from clients table
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email, created_by)
  SELECT 
    p_eod_date,
    c.inv_code,
    c.investor_name,
    c.ledger_balance,
    c.rm_email,
    auth.uid()
  FROM clients c
  WHERE c.status = 'Active' OR c.ledger_balance != 0;

  GET DIAGNOSTICS v_clients_captured = ROW_COUNT;

  -- Calculate total ledger balance
  SELECT COALESCE(SUM(ledger_balance), 0)
  INTO v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Create run history record
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
    v_user_email,
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
  )
  RETURNING id INTO v_run_id;

  -- Return results
  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'run_id', v_run_id,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell
  );
END;
$$;