-- Fix run_batch_eod function: correct column name (client_code → inv_code) and table name (investor_transactions → deposits_withdrawals)
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_total_gross_buy numeric := 0;
  v_total_gross_sell numeric := 0;
  v_user_email text;
  v_existing_count integer := 0;
BEGIN
  -- Set statement timeout to 10 minutes for large batch operations
  SET LOCAL statement_timeout = '600s';

  -- Get user email for audit
  SELECT email INTO v_user_email 
  FROM auth.users 
  WHERE id = auth.uid();

  -- Check for existing EOD data if skip_existing is true
  IF p_skip_existing THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date;
    
    IF v_existing_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', format('EOD for %s already exists with %s records', p_eod_date, v_existing_count),
        'existing_count', v_existing_count
      );
    END IF;
  ELSE
    -- Delete existing EOD data for this date
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Count distinct trade files for the date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD');

  -- Count deposit/withdrawal records for the date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Main EOD calculation using CTEs
  WITH 
  -- Get all unique investor codes from multiple sources
  all_investors AS (
    -- Source 1: Previous day EOD snapshots (use closing_balance if non-zero, else ledger_balance)
    SELECT 
      investor_code as inv_code,
      COALESCE(NULLIF(closing_balance, 0), ledger_balance, 0) as inv_opening,
      investor_name as inv_name,
      rm_email as inv_rm_email
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - INTERVAL '1 day'
    
    UNION ALL
    
    -- Source 2: Clients table (current balances) - FIXED: use inv_code instead of client_code
    SELECT 
      inv_code as inv_code,
      COALESCE(ledger_balance, 0) as inv_opening,
      investor_name as inv_name,
      rm_email as inv_rm_email
    FROM clients
    WHERE inv_code IS NOT NULL
    
    UNION ALL
    
    -- Source 3: Investors master table
    SELECT 
      investor_code as inv_code,
      0 as inv_opening,
      investor_name as inv_name,
      NULL as inv_rm_email
    FROM investors
    WHERE investor_code IS NOT NULL
  ),
  
  -- Deduplicate investors, prioritizing previous EOD snapshot, then clients, then investors
  unique_investors AS (
    SELECT DISTINCT ON (inv_code)
      inv_code,
      inv_opening,
      inv_name,
      inv_rm_email
    FROM all_investors
    WHERE inv_code IS NOT NULL AND inv_code != ''
    ORDER BY inv_code, inv_opening DESC NULLS LAST
  ),
  
  -- Get trade activity for the date
  trade_activity AS (
    SELECT 
      client_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(value, quantity * price) ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(value, quantity * price) ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(commission), 0) as total_commission
    FROM trade_history
    WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND UPPER(COALESCE(status, fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY client_code
  ),
  
  -- Get deposits and withdrawals for the date - FIXED: use deposits_withdrawals table
  investor_transactions AS (
    SELECT 
      investor_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  -- Get commission rates from investors table
  commission_rates AS (
    SELECT 
      investor_code as inv_code,
      COALESCE(brokerage_commission / 100.0, 0) as commission_rate
    FROM investors
    WHERE brokerage_commission IS NOT NULL
  ),
  
  -- Calculate final balances
  final_calculations AS (
    SELECT 
      ui.inv_code,
      ui.inv_name,
      ui.inv_rm_email,
      ui.inv_opening as opening_balance,
      COALESCE(it.deposits, 0) as total_deposits,
      COALESCE(it.withdrawals, 0) as total_withdrawals,
      COALESCE(ta.gross_buy, 0) as gross_buy,
      COALESCE(ta.gross_sell, 0) as gross_sell,
      COALESCE(ta.total_commission, 0) as total_commission,
      -- Net trade value = (Gross Sell - Sell Commission) - (Gross Buy + Buy Commission)
      -- Using simplified commission calculation
      (COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0)) as net_trade_value,
      -- Closing Balance = Opening + Deposits - Withdrawals + Net Trade Value
      (ui.inv_opening 
        + COALESCE(it.deposits, 0) 
        - COALESCE(it.withdrawals, 0) 
        + (COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0))
      ) as closing_balance
    FROM unique_investors ui
    LEFT JOIN trade_activity ta ON ta.inv_code = ui.inv_code
    LEFT JOIN investor_transactions it ON it.inv_code = ui.inv_code
  )
  
  -- Insert into snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_email,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    net_trade_value,
    closing_balance,
    ledger_balance,
    created_by
  )
  SELECT 
    p_eod_date,
    inv_code,
    inv_name,
    inv_rm_email,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    net_trade_value,
    closing_balance,
    closing_balance, -- ledger_balance = closing_balance
    auth.uid()
  FROM final_calculations;

  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0)
  INTO 
    v_clients_captured,
    v_total_ledger_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_total_gross_buy,
    v_total_gross_sell
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Insert into run history
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
    status,
    notes
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
    'completed',
    format('Batch EOD run with gross_buy: %s, gross_sell: %s', v_total_gross_buy, v_total_gross_sell)
  )
  ON CONFLICT (run_date) DO UPDATE SET
    run_by = EXCLUDED.run_by,
    run_by_email = EXCLUDED.run_by_email,
    clients_captured = EXCLUDED.clients_captured,
    total_ledger_balance = EXCLUDED.total_ledger_balance,
    trade_files_count = EXCLUDED.trade_files_count,
    deposit_records_count = EXCLUDED.deposit_records_count,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    run_at = now();

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_total_gross_buy,
    'gross_sell', v_total_gross_sell
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;