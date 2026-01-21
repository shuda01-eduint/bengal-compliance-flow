-- Drop existing function and recreate with corrected commission calculation
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_prev_date date;
  v_user_email text;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists, skipped', p_eod_date)
    );
  END IF;

  -- Delete existing snapshots for this date (if re-running)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Find the previous EOD date
  SELECT MAX(eod_date) INTO v_prev_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  -- Get user email for audit
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Main calculation using CTEs
  WITH 
  -- Get previous day's closing balances (opening balances for today)
  prev_day_balances AS (
    SELECT investor_code, ledger_balance as opening_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  
  -- Get all known investors from clients table
  all_investors AS (
    SELECT DISTINCT inv_code as investor_code, investor_name, rm_email
    FROM clients
  ),
  
  -- Combine all investor sources
  combined_investors AS (
    SELECT investor_code FROM prev_day_balances
    UNION
    SELECT investor_code FROM all_investors
  ),
  
  -- Calculate deposits for the day
  day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  -- Calculate net trade value for the day with commission from investors table fallback
  day_trades AS (
    SELECT 
      th.client_code as investor_code,
      SUM(
        CASE 
          WHEN UPPER(th.side) IN ('BUY', 'B') THEN 
            -COALESCE(th.value, th.quantity * th.price) 
            - (COALESCE(th.value, th.quantity * th.price) * 
               COALESCE(th.brokerage_commission, i.brokerage_commission / 100, 0.004))
          WHEN UPPER(th.side) IN ('SELL', 'S') THEN 
            COALESCE(th.value, th.quantity * th.price) 
            - (COALESCE(th.value, th.quantity * th.price) * 
               COALESCE(th.brokerage_commission, i.brokerage_commission / 100, 0.004))
          ELSE 0
        END
      ) as net_trade_value
    FROM trade_history th
    LEFT JOIN investors i ON th.client_code = i.investor_code
    WHERE th.trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
      AND (th.status IN ('FILL', 'PF') OR th.fill_type IN ('FILL', 'PF'))
    GROUP BY th.client_code
  ),
  
  -- Calculate final balances
  final_balances AS (
    SELECT 
      ci.investor_code,
      COALESCE(ai.investor_name, '') as investor_name,
      COALESCE(ai.rm_email, '') as rm_email,
      COALESCE(pb.opening_balance, 0) as opening_balance,
      COALESCE(dd.total_deposits, 0) as deposits,
      COALESCE(dd.total_withdrawals, 0) as withdrawals,
      COALESCE(dt.net_trade_value, 0) as net_trades,
      (
        COALESCE(pb.opening_balance, 0) 
        + COALESCE(dd.total_deposits, 0) 
        - COALESCE(dd.total_withdrawals, 0) 
        + COALESCE(dt.net_trade_value, 0)
      ) as closing_balance
    FROM combined_investors ci
    LEFT JOIN all_investors ai ON ci.investor_code = ai.investor_code
    LEFT JOIN prev_day_balances pb ON ci.investor_code = pb.investor_code
    LEFT JOIN day_deposits dd ON ci.investor_code = dd.investor_code
    LEFT JOIN day_trades dt ON ci.investor_code = dt.investor_code
  ),
  
  -- Insert snapshots
  inserted AS (
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_by)
    SELECT 
      p_eod_date,
      investor_code,
      investor_name,
      rm_email,
      closing_balance,
      auth.uid()
    FROM final_balances
    RETURNING *
  )
  
  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger_balance
  FROM inserted;

  -- Get trade file count
  SELECT COUNT(DISTINCT file_upload_id) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Get deposit/withdrawal stats
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records_count, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Record run history
  INSERT INTO eod_run_history (
    run_date, run_by, run_by_email, clients_captured, total_ledger_balance,
    trade_files_count, deposit_records_count, total_deposits, total_withdrawals, status
  ) VALUES (
    p_eod_date, auth.uid(), v_user_email, v_clients_captured, v_total_ledger_balance,
    v_trade_files_count, v_deposit_records_count, v_total_deposits, v_total_withdrawals, 'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'eod_date', p_eod_date,
    'previous_eod_date', v_prev_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  );

EXCEPTION WHEN OTHERS THEN
  -- Record failed run
  INSERT INTO eod_run_history (run_date, run_by, run_by_email, status, notes)
  VALUES (p_eod_date, auth.uid(), v_user_email, 'failed', SQLERRM);
  
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'eod_date', p_eod_date
  );
END;
$$;