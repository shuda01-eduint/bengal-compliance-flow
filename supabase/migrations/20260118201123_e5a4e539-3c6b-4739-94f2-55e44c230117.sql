-- Drop existing function and recreate with optimizations
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SET statement_timeout = '600s'
AS $$
DECLARE
  v_prev_eod_date date;
  v_trade_date_text text;
  v_inserted_count integer := 0;
  v_skipped_count integer := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_existing_run_id uuid;
BEGIN
  -- Convert EOD date to trade_date format (YYYYMMDD)
  v_trade_date_text := to_char(p_eod_date, 'YYYYMMDD');
  
  -- Check if EOD already exists for this date
  SELECT id INTO v_existing_run_id
  FROM eod_run_history
  WHERE run_date = p_eod_date
  LIMIT 1;
  
  -- Skip if requested and already exists
  IF p_skip_existing AND v_existing_run_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists, skipped', p_eod_date)
    );
  END IF;
  
  -- If rerunning, delete existing data for this date
  IF v_existing_run_id IS NOT NULL THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;
  
  -- Find the most recent previous EOD date
  SELECT MAX(eod_date) INTO v_prev_eod_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;
  
  -- Get trade files count for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_trade_date_text;
  
  -- Get deposit records count for this date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;
  
  -- Pre-aggregate deposits/withdrawals by investor
  WITH day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Pre-aggregate trades by client_code (investor_code)
  day_trades AS (
    SELECT 
      client_code,
      SUM(CASE 
        WHEN UPPER(side) = 'BUY' THEN COALESCE(value, 0) + COALESCE(brokerage_commission, 0)
        ELSE 0 
      END) as buy_value,
      SUM(CASE 
        WHEN UPPER(side) = 'SELL' THEN COALESCE(value, 0) - COALESCE(brokerage_commission, 0)
        ELSE 0 
      END) as sell_value
    FROM trade_history
    WHERE trade_date = v_trade_date_text
      AND UPPER(COALESCE(fill_type, status, '')) IN ('FILL', 'PF')
    GROUP BY client_code
  ),
  -- Get previous EOD balances
  prev_eod AS (
    SELECT investor_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_eod_date
  ),
  -- Calculate new EOD balances for all investors
  new_eod AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      -- Get RM email from investor_rm_assignments
      (SELECT rm_email FROM investor_rm_assignments WHERE investor_code = i.investor_code LIMIT 1) as rm_email,
      -- Calculate closing balance: previous_balance + deposits - withdrawals - buy_value + sell_value
      COALESCE(pe.ledger_balance, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0)
        - COALESCE(dt.buy_value, 0)
        + COALESCE(dt.sell_value, 0) as closing_balance,
      COALESCE(dd.deposits, 0) as day_deposits,
      COALESCE(dd.withdrawals, 0) as day_withdrawals
    FROM investors i
    LEFT JOIN prev_eod pe ON pe.investor_code = i.investor_code
    LEFT JOIN day_deposits dd ON dd.investor_code = i.investor_code
    LEFT JOIN day_trades dt ON dt.client_code = i.investor_code
  )
  -- Insert new EOD snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    ledger_balance,
    rm_email,
    created_at
  )
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    closing_balance,
    rm_email,
    now()
  FROM new_eod;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- Calculate totals for history record
  SELECT 
    COALESCE(SUM(ledger_balance), 0),
    COUNT(*)
  INTO v_total_ledger, v_inserted_count
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;
  
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;
  
  -- Insert history record
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
    trade_files_count,
    deposit_records_count,
    notes
  ) VALUES (
    p_eod_date,
    now(),
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'completed',
    v_inserted_count,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    v_trade_files_count,
    v_deposit_records_count,
    format('EOD run for %s. Prev EOD: %s', p_eod_date, COALESCE(v_prev_eod_date::text, 'none'))
  );
  
  RETURN json_build_object(
    'success', true,
    'skipped', false,
    'date', p_eod_date,
    'clients_captured', v_inserted_count,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'previous_eod_date', v_prev_eod_date
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'date', p_eod_date
  );
END;
$$;