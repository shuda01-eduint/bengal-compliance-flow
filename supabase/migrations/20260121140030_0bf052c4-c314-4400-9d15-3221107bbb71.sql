-- Step 1: Add new columns to eod_ledger_snapshots for cascading calculation
ALTER TABLE eod_ledger_snapshots 
ADD COLUMN IF NOT EXISTS opening_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS closing_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS gross_buy NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS gross_sell NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_deposits NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_withdrawals NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_commission NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS net_trade_value NUMERIC DEFAULT 0;

-- Step 2: Replace run_batch_eod function with FULL OUTER JOIN logic
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
  v_previous_date date;
BEGIN
  -- Convert date to YYYYMMDD text format for trade_history comparison
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_previous_date := p_eod_date - INTERVAL '1 day';

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

  -- Count distinct trade files for this date
  SELECT COUNT(DISTINCT file_name)
  INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_trade_date_str
    AND file_name IS NOT NULL;

  -- Count deposit/withdrawal records
  SELECT COUNT(*)
  INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Insert EOD snapshots with cascading balance calculation
  -- Uses FULL OUTER JOIN between previous EOD, clients, and investors tables
  WITH previous_eod AS (
    SELECT investor_code, closing_balance as prev_balance, investor_name, rm_email
    FROM eod_ledger_snapshots
    WHERE eod_date = v_previous_date
  ),
  all_investors AS (
    -- Union of all investor sources with priority: previous_eod > clients > investors
    SELECT DISTINCT ON (inv_code)
      inv_code,
      investor_name,
      rm_email,
      opening_bal
    FROM (
      -- Source 1: Previous EOD snapshots (highest priority for opening balance)
      SELECT 
        p.investor_code as inv_code,
        p.investor_name,
        p.rm_email,
        p.prev_balance as opening_bal,
        1 as priority
      FROM previous_eod p
      
      UNION ALL
      
      -- Source 2: Clients table (for active traders)
      SELECT 
        c.inv_code,
        c.investor_name,
        c.rm_email,
        c.ledger_balance as opening_bal,
        2 as priority
      FROM clients c
      
      UNION ALL
      
      -- Source 3: Investors table (master data)
      SELECT 
        i.investor_code as inv_code,
        i.investor_name,
        COALESCE(
          (SELECT ra.rm_email FROM investor_rm_assignments ra WHERE ra.investor_code = i.investor_code LIMIT 1),
          NULL
        ) as rm_email,
        0 as opening_bal,
        3 as priority
      FROM investors i
    ) combined
    ORDER BY inv_code, priority
  ),
  day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN UPPER(transaction_type) IN ('DEPOSIT', 'D') THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(transaction_type) IN ('WITHDRAWAL', 'W') THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      client_code as investor_code,
      SUM(CASE WHEN UPPER(side) IN ('B', 'BUY') THEN COALESCE(value, quantity * price, 0) ELSE 0 END) as buy_value,
      SUM(CASE WHEN UPPER(side) IN ('S', 'SELL') THEN COALESCE(value, quantity * price, 0) ELSE 0 END) as sell_value,
      SUM(
        CASE 
          WHEN UPPER(side) IN ('B', 'BUY') THEN 
            COALESCE(value, quantity * price, 0) * 
            COALESCE(
              th.brokerage_commission / 100.0,
              (SELECT inv.brokerage_commission / 100.0 FROM investors inv WHERE inv.investor_code = th.client_code),
              0.004
            )
          ELSE 0 
        END
      ) as buy_commission,
      SUM(
        CASE 
          WHEN UPPER(side) IN ('S', 'SELL') THEN 
            COALESCE(value, quantity * price, 0) * 
            COALESCE(
              th.brokerage_commission / 100.0,
              (SELECT inv.brokerage_commission / 100.0 FROM investors inv WHERE inv.investor_code = th.client_code),
              0.004
            )
          ELSE 0 
        END
      ) as sell_commission
    FROM trade_history th
    WHERE trade_date = v_trade_date_str
      AND (UPPER(status) IN ('FILL', 'PF', 'FILLED', 'PARTIAL') 
           OR UPPER(fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL') 
           OR status IS NULL)
    GROUP BY client_code
  ),
  calculated AS (
    SELECT 
      ai.inv_code,
      ai.investor_name,
      ai.rm_email,
      ai.opening_bal as opening_balance,
      COALESCE(dd.deposits, 0) as total_deposits,
      COALESCE(dd.withdrawals, 0) as total_withdrawals,
      COALESCE(dt.buy_value, 0) as gross_buy,
      COALESCE(dt.sell_value, 0) as gross_sell,
      COALESCE(dt.buy_commission, 0) + COALESCE(dt.sell_commission, 0) as total_commission,
      -- Net trade = sell proceeds - buy cost (both including commission)
      (COALESCE(dt.sell_value, 0) - COALESCE(dt.sell_commission, 0)) - 
      (COALESCE(dt.buy_value, 0) + COALESCE(dt.buy_commission, 0)) as net_trade_value,
      -- Closing = Opening + Deposits - Withdrawals + Net Trade
      ai.opening_bal 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0)
        + (COALESCE(dt.sell_value, 0) - COALESCE(dt.sell_commission, 0))
        - (COALESCE(dt.buy_value, 0) + COALESCE(dt.buy_commission, 0)) as closing_balance
    FROM all_investors ai
    LEFT JOIN day_deposits dd ON dd.investor_code = ai.inv_code
    LEFT JOIN day_trades dt ON dt.investor_code = ai.inv_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date, 
    investor_code, 
    investor_name, 
    rm_email,
    opening_balance,
    closing_balance,
    ledger_balance,
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value,
    created_by
  )
  SELECT 
    p_eod_date,
    inv_code,
    investor_name,
    rm_email,
    opening_balance,
    closing_balance,
    closing_balance, -- ledger_balance = closing_balance for backward compatibility
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value,
    auth.uid()
  FROM calculated;

  GET DIAGNOSTICS v_clients_captured = ROW_COUNT;

  -- Calculate aggregates from inserted snapshots
  SELECT 
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0)
  INTO v_total_ledger_balance, v_total_deposits, v_total_withdrawals, v_gross_buy, v_gross_sell
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