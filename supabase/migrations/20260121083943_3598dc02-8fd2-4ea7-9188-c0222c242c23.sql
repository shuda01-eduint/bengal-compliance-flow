-- Drop the broken function and recreate with correct column names
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
BEGIN
  -- Check if data already exists for this date
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_balances WHERE eod_date = p_eod_date LIMIT 1) THEN
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
    DELETE FROM eod_balances WHERE eod_date = p_eod_date;
  END IF;

  -- Find the previous business day that has EOD data
  SELECT MAX(eod_date) INTO v_previous_date
  FROM eod_balances
  WHERE eod_date < p_eod_date;

  -- Insert new EOD balances
  WITH previous_day_balances AS (
    SELECT 
      investor_code,
      ledger_balance,
      investor_name,
      rm_email
    FROM eod_balances
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
      AND transaction_type = 'DEPOSIT'
    GROUP BY investor_code
  ),
  day_withdrawals AS (
    SELECT 
      investor_code,
      SUM(amount) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
      AND transaction_type = 'WITHDRAWAL'
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
  )
  INSERT INTO eod_balances (
    eod_date,
    investor_code,
    investor_name,
    rm_email,
    opening_balance,
    deposits,
    withdrawals,
    net_trades,
    ledger_balance
  )
  SELECT 
    p_eod_date,
    ob.investor_code,
    ob.investor_name,
    ob.rm_email,
    ob.opening_balance,
    COALESCE(dd.total_deposits, 0),
    COALESCE(dw.total_withdrawals, 0),
    COALESCE(dt.net_trade_value, 0),
    ob.opening_balance + COALESCE(dd.total_deposits, 0) - COALESCE(dw.total_withdrawals, 0) + COALESCE(dt.net_trade_value, 0)
  FROM opening_balances ob
  LEFT JOIN day_deposits dd ON dd.investor_code = ob.investor_code
  LEFT JOIN day_withdrawals dw ON dw.investor_code = ob.investor_code
  LEFT JOIN day_trades dt ON dt.investor_code = ob.investor_code
  WHERE ob.investor_code IS NOT NULL;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'inserted_count', v_inserted_count,
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