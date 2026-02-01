-- Fix run_batch_eod to count trade files from trade_file table (the new staging table)
-- instead of trade_history (the old table)
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_inserted_count integer := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_date_str text;
BEGIN
  -- Security check
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Admin role required',
      'clients_captured', 0
    );
  END IF;

  -- Convert date to YYYYMMDD format for trade_history comparison
  v_date_str := to_char(p_eod_date, 'YYYYMMDD');

  -- FIX: Get trade files count from trade_file table (new staging table)
  -- Count distinct exchange_code as a proxy for "files" since trade_file doesn't have file_name
  SELECT COUNT(DISTINCT exchange_code) INTO v_trade_files_count
  FROM trade_file
  WHERE trade_date = p_eod_date;

  -- Get deposit records count for this date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
    INTO v_inserted_count, v_total_ledger
    FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'clients_captured', v_inserted_count,
      'total_ledger_balance', v_total_ledger,
      'message', 'Skipped - data already exists for this date'
    );
  END IF;

  -- Delete existing snapshots for this date (if not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Main EOD calculation: Use trade_file as the primary trade source
  WITH 
  -- Previous day's EOD snapshots for opening balance
  prev_closing AS MATERIALIZED (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      closing_balance,
      eod_date as prev_date
    FROM eod_ledger_snapshots
    WHERE eod_date < p_eod_date
    ORDER BY investor_code, eod_date DESC
  ),
  
  -- Today's trades from trade_file (new staging table)
  today_trades AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(qty * price, 0) ELSE 0 END) as gross_sell,
      SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(qty * price, 0) ELSE 0 END) as gross_buy,
      SUM(COALESCE(commission, 0)) as total_commission
    FROM trade_file
    WHERE trade_date = p_eod_date
      AND investor_code IS NOT NULL
    GROUP BY investor_code
  ),
  
  -- Deposit/withdrawal from deposits_withdrawals table
  dw_deltas AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  -- Universe: all investors who should have EOD snapshot
  universe AS MATERIALIZED (
    SELECT DISTINCT investor_code
    FROM (
      SELECT investor_code FROM investors WHERE status = 'Active'
      UNION
      SELECT investor_code FROM trade_file WHERE trade_date = p_eod_date AND investor_code IS NOT NULL
      UNION
      SELECT investor_code FROM prev_closing
      UNION
      SELECT investor_code FROM dw_deltas
    ) all_codes
    WHERE investor_code IS NOT NULL
  ),
  
  -- Investor master data
  investor_master AS MATERIALIZED (
    SELECT
      investor_code,
      investor_name,
      brokerage_commission,
      interest_rate,
      ledger_balance,
      account_type,
      department
    FROM investors
  ),
  
  -- Final calculation
  final_calc AS (
    SELECT
      u.investor_code,
      COALESCE(im.investor_name, 'Unknown') as investor_name,
      
      -- Opening balance: previous closing OR investor baseline OR 0
      COALESCE(pc.closing_balance, im.ledger_balance, 0) as opening_balance,
      
      -- Trade values
      COALESCE(tt.gross_buy, 0) as gross_buy,
      COALESCE(tt.gross_sell, 0) as gross_sell,
      COALESCE(tt.total_commission, 0) as total_commission,
      
      -- Deposit/withdrawal deltas
      COALESCE(dw.deposits, 0) as total_deposits,
      COALESCE(dw.withdrawals, 0) as total_withdrawals,
      
      -- Closing balance calculation:
      -- opening + deposits - withdrawals + sell_proceeds - buy_cost - commission
      COALESCE(pc.closing_balance, im.ledger_balance, 0)
        + COALESCE(dw.deposits, 0)
        - COALESCE(dw.withdrawals, 0)
        + COALESCE(tt.gross_sell, 0)
        - COALESCE(tt.gross_buy, 0)
        - COALESCE(tt.total_commission, 0) as closing_balance,
      
      -- Metadata
      COALESCE(im.account_type, 'Cash') as account_type,
      COALESCE(im.brokerage_commission, 0.004) as brokerage_rate,
      COALESCE(im.interest_rate, 0) as interest_rate,
      im.department
    FROM universe u
    LEFT JOIN prev_closing pc ON u.investor_code = pc.investor_code
    LEFT JOIN today_trades tt ON u.investor_code = tt.investor_code
    LEFT JOIN dw_deltas dw ON u.investor_code = dw.investor_code
    LEFT JOIN investor_master im ON u.investor_code = im.investor_code
  )
  
  -- Insert EOD snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    opening_balance,
    closing_balance,
    ledger_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    account_type,
    brokerage_rate,
    interest_rate,
    department,
    created_at
  )
  SELECT
    p_eod_date,
    investor_code,
    investor_name,
    opening_balance,
    closing_balance,
    closing_balance as ledger_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    account_type,
    brokerage_rate,
    interest_rate,
    department,
    now()
  FROM final_calc;

  -- Get inserted count and totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_inserted_count,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record in EOD run history
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
    gross_buy,
    gross_sell,
    total_commission,
    status
  ) VALUES (
    p_eod_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_inserted_count,
    v_total_ledger,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'completed'
  )
  ON CONFLICT (run_date) DO UPDATE SET
    run_at = now(),
    run_by = auth.uid(),
    run_by_email = (SELECT email FROM auth.users WHERE id = auth.uid()),
    clients_captured = EXCLUDED.clients_captured,
    total_ledger_balance = EXCLUDED.total_ledger_balance,
    trade_files_count = EXCLUDED.trade_files_count,
    deposit_records_count = EXCLUDED.deposit_records_count,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    gross_buy = EXCLUDED.gross_buy,
    gross_sell = EXCLUDED.gross_sell,
    total_commission = EXCLUDED.total_commission,
    status = 'completed';

  RETURN jsonb_build_object(
    'success', true,
    'clients_captured', v_inserted_count,
    'total_ledger_balance', v_total_ledger,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE,
    'clients_captured', 0
  );
END;
$$;