-- Restore statement_timeout to prevent timeout errors during batch EOD processing
-- The previous migration removed this setting, causing the function to timeout after ~8 seconds

DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  v_total_clients integer := 0;
  v_total_balance numeric := 0;
  v_trade_date_str text;
  v_existing_count integer := 0;
  v_trade_files_count integer := 0;
  v_deposit_records integer := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_result json;
BEGIN
  -- Format trade date as YYYYMMDD to match trade_history.trade_date format
  v_trade_date_str := TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Check if EOD already exists for this date
  SELECT COUNT(*) INTO v_existing_count
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- If skip existing is true and data exists, return early
  IF p_skip_existing AND v_existing_count > 0 THEN
    SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
    INTO v_total_clients, v_total_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date;

    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for ' || p_eod_date::text,
      'clients_captured', v_total_clients,
      'total_ledger_balance', v_total_balance
    );
  END IF;

  -- Get counts for diagnostics before deleting
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_trade_date_str;

  SELECT COUNT(*) INTO v_deposit_records
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Delete existing snapshots for this date (recalculate)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Insert new snapshots with robust calculation
  WITH previous_day_balances AS (
    SELECT investor_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - INTERVAL '1 day'
  ),
  opening_balances AS (
    SELECT 
      COALESCE(p.investor_code, c.inv_code) as investor_code,
      COALESCE(p.ledger_balance, c.ledger_balance, 0) as opening_balance,
      c.investor_name,
      c.rm_email
    FROM clients c
    LEFT JOIN previous_day_balances p ON p.investor_code = c.inv_code
  ),
  day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) LIKE '%deposit%' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(transaction_type) LIKE '%withdrawal%' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      t.client_code as investor_code,
      SUM(CASE WHEN UPPER(t.side) IN ('BUY', 'B') THEN COALESCE(t.value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN UPPER(t.side) IN ('SELL', 'S') THEN COALESCE(t.value, 0) ELSE 0 END) as total_sell,
      -- Calculate commission: value * normalized_rate
      -- Use trade-level commission if available, otherwise use investor default
      -- Normalize: if rate >= 0.1, treat as percentage (divide by 100)
      SUM(
        COALESCE(t.value, 0) * 
        CASE 
          WHEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) >= 0.1 
          THEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) / 100
          ELSE COALESCE(t.brokerage_commission, i.brokerage_commission, 0)
        END
      ) as total_commission
    FROM trade_history t
    LEFT JOIN investors i ON i.investor_code = t.client_code
    WHERE t.trade_date = v_trade_date_str
      -- Filter for filled trades: check both status and fill_type
      AND (
        UPPER(COALESCE(t.status, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
        OR UPPER(COALESCE(t.fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
      )
    GROUP BY t.client_code
  ),
  calculated_balances AS (
    SELECT 
      o.investor_code,
      o.investor_name,
      o.rm_email,
      o.opening_balance,
      COALESCE(d.deposits, 0) as deposits,
      COALESCE(d.withdrawals, 0) as withdrawals,
      COALESCE(t.total_buy, 0) as total_buy,
      COALESCE(t.total_sell, 0) as total_sell,
      COALESCE(t.total_commission, 0) as total_commission,
      -- Formula: opening + deposits - withdrawals - buys + sells - commission
      o.opening_balance 
        + COALESCE(d.deposits, 0) 
        - COALESCE(d.withdrawals, 0) 
        - COALESCE(t.total_buy, 0) 
        + COALESCE(t.total_sell, 0) 
        - COALESCE(t.total_commission, 0) as closing_balance
    FROM opening_balances o
    LEFT JOIN day_deposits d ON d.investor_code = o.investor_code
    LEFT JOIN day_trades t ON t.investor_code = o.investor_code
  )
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_at)
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    rm_email,
    closing_balance,
    now()
  FROM calculated_balances;

  -- Get final counts and totals
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_total_clients, v_total_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Get aggregate stats for debugging
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN value ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) IN ('SELL', 'S') THEN value ELSE 0 END), 0),
    COALESCE(SUM(
      value * CASE 
        WHEN COALESCE(t.brokerage_commission, 0) >= 0.1 THEN COALESCE(t.brokerage_commission, 0) / 100
        ELSE COALESCE(t.brokerage_commission, 0)
      END
    ), 0)
  INTO v_gross_buy, v_gross_sell, v_total_commission
  FROM trade_history t
  WHERE t.trade_date = v_trade_date_str
    AND (
      UPPER(COALESCE(t.status, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
      OR UPPER(COALESCE(t.fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    );

  SELECT 
    COALESCE(SUM(CASE WHEN LOWER(transaction_type) LIKE '%deposit%' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN LOWER(transaction_type) LIKE '%withdrawal%' THEN amount ELSE 0 END), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Record in history
  INSERT INTO eod_run_history (
    run_date, clients_captured, total_ledger_balance, status, run_at,
    trade_files_count, deposit_records_count, total_deposits, total_withdrawals
  )
  VALUES (
    p_eod_date, v_total_clients, v_total_balance, 'completed', now(),
    v_trade_files_count, v_deposit_records, v_total_deposits, v_total_withdrawals
  )
  ON CONFLICT (run_date) DO UPDATE SET
    clients_captured = EXCLUDED.clients_captured,
    total_ledger_balance = EXCLUDED.total_ledger_balance,
    status = EXCLUDED.status,
    run_at = EXCLUDED.run_at,
    trade_files_count = EXCLUDED.trade_files_count,
    deposit_records_count = EXCLUDED.deposit_records_count,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals;

  -- Return detailed result for debugging
  v_result := json_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_total_clients,
    'total_ledger_balance', v_total_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  );

  RETURN v_result;
END;
$$;