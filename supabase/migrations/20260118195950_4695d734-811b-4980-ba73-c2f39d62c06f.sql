-- Fix run_batch_eod function to handle NULL brokerage_commission and case-insensitive side comparison
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_previous_date date;
  v_clients_captured int := 0;
  v_total_ledger_balance numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_deposit_records_count int := 0;
  v_trade_files_count int := 0;
  v_run_id uuid;
  v_user_id uuid;
  v_user_email text;
  v_skipped boolean := false;
  v_mismatch_count int := 0;
  v_mismatches json := '[]'::json;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date AND status = 'success'
  ) THEN
    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists, skipped', p_eod_date),
      'run_date', p_eod_date
    );
  END IF;

  -- Get the most recent EOD date before the target date
  SELECT MAX(eod_date) INTO v_previous_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  -- Get current user info
  BEGIN
    v_user_id := auth.uid();
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
    v_user_email := 'system';
  END;

  -- Delete existing EOD data for this date (if re-running)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Create new EOD snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    ledger_balance,
    rm_email,
    created_by
  )
  SELECT 
    p_eod_date,
    COALESCE(prev.investor_code, t.client_code, dw.investor_code) as investor_code,
    COALESCE(i.investor_name, prev.investor_name) as investor_name,
    COALESCE(prev.ledger_balance, 0) 
      + COALESCE(t.trade_balance, 0)
      + COALESCE(dw.net_deposit, 0) as ledger_balance,
    COALESCE(prev.rm_email, dw.rm_email) as rm_email,
    v_user_id
  FROM (
    -- Previous day's balances
    SELECT investor_code, investor_name, ledger_balance, rm_email
    FROM eod_ledger_snapshots
    WHERE eod_date = v_previous_date
  ) prev
  FULL OUTER JOIN (
    -- Trade activity for the target date - FIXED: Handle NULL commission and case-insensitive side
    SELECT 
      client_code,
      SUM(
        CASE 
          WHEN UPPER(side) = 'SELL' THEN 
            COALESCE(value, 0) * (1 - COALESCE(brokerage_commission, 0) / 100.0)
          WHEN UPPER(side) = 'BUY' THEN 
            -COALESCE(value, 0) * (1 + COALESCE(brokerage_commission, 0) / 100.0)
          ELSE 0
        END
      ) as trade_balance
    FROM trade_history
    WHERE trade_date = p_eod_date::text
    GROUP BY client_code
  ) t ON prev.investor_code = t.client_code
  FULL OUTER JOIN (
    -- Deposits/Withdrawals for the target date
    SELECT 
      investor_code,
      rm_email,
      SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END) as net_deposit
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code, rm_email
  ) dw ON COALESCE(prev.investor_code, t.client_code) = dw.investor_code
  LEFT JOIN investors i ON COALESCE(prev.investor_code, t.client_code, dw.investor_code) = i.investor_code
  WHERE COALESCE(prev.investor_code, t.client_code, dw.investor_code) IS NOT NULL;

  -- Get statistics
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_total_deposits, v_total_withdrawals, v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  SELECT COUNT(DISTINCT file_name)
  INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = p_eod_date::text;

  -- Create run history record
  INSERT INTO eod_run_history (
    run_date,
    status,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    deposit_records_count,
    trade_files_count,
    run_by,
    run_by_email
  ) VALUES (
    p_eod_date,
    'success',
    v_clients_captured,
    v_total_ledger_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_deposit_records_count,
    v_trade_files_count,
    v_user_id,
    v_user_email
  )
  RETURNING id INTO v_run_id;

  RETURN json_build_object(
    'success', true,
    'skipped', false,
    'run_id', v_run_id,
    'run_date', p_eod_date,
    'previous_eod_date', v_previous_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'deposit_records_count', v_deposit_records_count,
    'trade_files_count', v_trade_files_count,
    'mismatch_count', v_mismatch_count,
    'mismatches', v_mismatches
  );
END;
$$;