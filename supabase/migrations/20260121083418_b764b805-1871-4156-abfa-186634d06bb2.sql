
-- Drop the existing function first
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

-- Recreate with FULL OUTER JOIN to include ALL investors from previous EOD snapshots
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600s'
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured integer;
  v_total_ledger_balance numeric;
  v_trade_files_count integer;
  v_deposit_records_count integer;
  v_total_deposits numeric;
  v_total_withdrawals numeric;
  v_skipped boolean := false;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    SELECT jsonb_build_object(
      'success', true,
      'skipped', true,
      'date', p_eod_date,
      'message', 'EOD already exists for this date'
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- Delete existing snapshots for this date (if not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Get trade files count for the date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Get deposit/withdrawal stats
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records_count, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Insert EOD snapshots using FULL OUTER JOIN to include ALL investors
  -- from either clients table OR previous day's EOD snapshot
  WITH previous_day_balances AS (
    SELECT investor_code, investor_name, rm_email, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - INTERVAL '1 day'
  ),
  opening_balances AS (
    -- FULL OUTER JOIN ensures we include:
    -- 1. Investors in clients table (current active clients)
    -- 2. Investors in previous EOD snapshot (may not be in clients but have history)
    SELECT 
      COALESCE(p.investor_code, c.inv_code) as investor_code,
      COALESCE(p.ledger_balance, c.ledger_balance, 0) as opening_balance,
      COALESCE(p.investor_name, c.investor_name) as investor_name,
      COALESCE(p.rm_email, c.rm_email) as rm_email
    FROM previous_day_balances p
    FULL OUTER JOIN clients c ON c.inv_code = p.investor_code
  ),
  day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      inv_code as investor_code,
      SUM(
        CASE 
          WHEN UPPER(side) IN ('BUY', 'B') THEN 
            -(quantity * rate) - 
            CASE 
              WHEN commission >= 0.1 THEN commission / 100 
              ELSE COALESCE(commission, 0.004) 
            END * (quantity * rate)
          WHEN UPPER(side) IN ('SELL', 'S') THEN 
            (quantity * rate) - 
            CASE 
              WHEN commission >= 0.1 THEN commission / 100 
              ELSE COALESCE(commission, 0.004) 
            END * (quantity * rate)
          ELSE 0
        END
      ) as net_trade_value
    FROM trade_history
    WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
      AND (status IN ('FILL', 'PF') OR fill_type IN ('FILL', 'PF'))
    GROUP BY inv_code
  ),
  calculated_balances AS (
    SELECT 
      ob.investor_code,
      ob.investor_name,
      ob.rm_email,
      ob.opening_balance,
      COALESCE(dd.deposits, 0) as deposits,
      COALESCE(dd.withdrawals, 0) as withdrawals,
      COALESCE(dt.net_trade_value, 0) as net_trades,
      ob.opening_balance + COALESCE(dd.deposits, 0) - COALESCE(dd.withdrawals, 0) + COALESCE(dt.net_trade_value, 0) as closing_balance
    FROM opening_balances ob
    LEFT JOIN day_deposits dd ON dd.investor_code = ob.investor_code
    LEFT JOIN day_trades dt ON dt.investor_code = ob.investor_code
  )
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_by)
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    rm_email,
    closing_balance,
    auth.uid()
  FROM calculated_balances
  WHERE investor_code IS NOT NULL;

  -- Get summary stats
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record in history
  INSERT INTO eod_run_history (
    run_date, 
    clients_captured, 
    total_ledger_balance, 
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    run_by,
    run_by_email,
    status
  )
  VALUES (
    p_eod_date,
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'completed'
  );

  -- Build result
  SELECT jsonb_build_object(
    'success', true,
    'skipped', false,
    'date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  ) INTO v_result;

  RETURN v_result;
END;
$$;
