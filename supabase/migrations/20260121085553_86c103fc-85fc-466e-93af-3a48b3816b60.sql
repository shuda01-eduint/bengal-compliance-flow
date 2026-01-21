-- Drop the broken function that references non-existent eod_balances table
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600s'
AS $$
DECLARE
  v_result jsonb;
  v_inserted_count integer;
  v_skipped boolean := false;
  v_previous_date date;
  v_total_ledger_balance numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
BEGIN
  -- Check if data already exists for this date
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1) THEN
      RETURN jsonb_build_object(
        'success', true,
        'eod_date', p_eod_date,
        'inserted_count', 0,
        'skipped', true,
        'message', 'Data already exists for this date, skipped'
      );
    END IF;
  ELSE
    -- Delete existing data for this date if not skipping
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Find the previous business day that has EOD data
  SELECT MAX(eod_date) INTO v_previous_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  -- Get trade files count for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Get deposit/withdrawal records count
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Insert new EOD ledger snapshots
  WITH previous_day_balances AS (
    SELECT 
      investor_code,
      ledger_balance,
      investor_name,
      rm_email
    FROM eod_ledger_snapshots
    WHERE eod_date = v_previous_date
  ),
  -- Use FULL OUTER JOIN to include ALL investors from both sources
  opening_balances AS (
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
      SUM(amount) as total_deposits
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
      AND LOWER(transaction_type) LIKE '%deposit%'
    GROUP BY investor_code
  ),
  day_withdrawals AS (
    SELECT 
      investor_code,
      SUM(amount) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
      AND LOWER(transaction_type) LIKE '%withdraw%'
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      client_code as investor_code,
      SUM(
        CASE 
          WHEN UPPER(side) IN ('BUY', 'B') THEN 
            -(quantity * price) - 
            ((quantity * price) * 
              CASE 
                WHEN COALESCE(commission_rate, 0) >= 0.1 THEN COALESCE(commission_rate, 0) / 100
                ELSE COALESCE(commission_rate, 0.004)
              END
            )
          WHEN UPPER(side) IN ('SELL', 'S') THEN 
            (quantity * price) - 
            ((quantity * price) * 
              CASE 
                WHEN COALESCE(commission_rate, 0) >= 0.1 THEN COALESCE(commission_rate, 0) / 100
                ELSE COALESCE(commission_rate, 0.004)
              END
            )
          ELSE 0
        END
      ) as net_trade_value
    FROM trade_history
    WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
      AND (status IN ('FILL', 'PF') OR fill_type IN ('FILL', 'PF'))
    GROUP BY client_code
  ),
  inserted_rows AS (
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      rm_email,
      ledger_balance,
      created_by
    )
    SELECT 
      p_eod_date,
      ob.investor_code,
      ob.investor_name,
      ob.rm_email,
      ob.opening_balance + COALESCE(dd.total_deposits, 0) - COALESCE(dw.total_withdrawals, 0) + COALESCE(dt.net_trade_value, 0),
      auth.uid()
    FROM opening_balances ob
    LEFT JOIN day_deposits dd ON dd.investor_code = ob.investor_code
    LEFT JOIN day_withdrawals dw ON dw.investor_code = ob.investor_code
    LEFT JOIN day_trades dt ON dt.investor_code = ob.investor_code
    WHERE ob.investor_code IS NOT NULL
    RETURNING ledger_balance
  )
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0) INTO v_inserted_count, v_total_ledger_balance
  FROM inserted_rows;

  -- Calculate totals for history
  SELECT COALESCE(SUM(amount), 0) INTO v_total_deposits
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
    AND LOWER(transaction_type) LIKE '%deposit%';

  SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
    AND LOWER(transaction_type) LIKE '%withdraw%';

  -- Insert into eod_run_history
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
  )
  VALUES (
    p_eod_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_inserted_count,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'inserted_count', v_inserted_count,
    'clients_captured', v_inserted_count,
    'total_ledger_balance', v_total_ledger_balance,
    'skipped', false,
    'previous_date_used', v_previous_date
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'eod_date', p_eod_date,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;