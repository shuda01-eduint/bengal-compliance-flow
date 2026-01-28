-- Fix: EOD Deposit/Withdrawal Calculation Bug
-- Use deposits_withdrawals table as sole source for daily transactions
-- instead of GREATEST() logic with trade history deltas

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $function$
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

  -- Get trade files count for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_date_str;

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

  -- Main EOD calculation with FIX: Use deposits_withdrawals as sole source
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
  
  -- Today's trades aggregated
  today_trades AS MATERIALIZED (
    SELECT
      client_code as investor_code,
      SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(COALESCE(brokerage_commission, 0)) as total_commission,
      MAX(ledger_balance_snapshot) as ledger_balance_snapshot,
      MAX(rm_id) as rm_id,
      MAX(rm_name) as rm_name,
      MAX(department) as department,
      MAX(account_type) as account_type,
      MAX(interest_rate) as interest_rate
    FROM trade_history
    WHERE trade_date = v_date_str
      AND client_code IS NOT NULL
    GROUP BY client_code
  ),
  
  -- FIX: Deposit/withdrawal from deposits_withdrawals table ONLY (no trade history delta)
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
      SELECT client_code as investor_code FROM trade_history WHERE trade_date = v_date_str AND client_code IS NOT NULL
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
      
      -- FIX: Use deposits_withdrawals as SOLE source (no GREATEST with trade history)
      COALESCE(dw.deposits, 0) as total_deposits,
      COALESCE(dw.withdrawals, 0) as total_withdrawals,
      
      -- Snapshot from trade file (for audit)
      COALESCE(tt.ledger_balance_snapshot, 0) as ledger_balance_snapshot,
      
      -- Metadata
      COALESCE(tt.rm_id, im.department) as rm_id,
      COALESCE(tt.rm_name, '') as rm_name,
      COALESCE(tt.department, im.department, '') as department,
      COALESCE(tt.account_type, im.account_type, '') as account_type,
      COALESCE(im.brokerage_commission, 0) as brokerage_rate,
      COALESCE(tt.interest_rate, im.interest_rate, 0) as interest_rate
    FROM universe u
    LEFT JOIN prev_closing pc ON pc.investor_code = u.investor_code
    LEFT JOIN today_trades tt ON tt.investor_code = u.investor_code
    LEFT JOIN dw_deltas dw ON dw.investor_code = u.investor_code
    LEFT JOIN investor_master im ON im.investor_code = u.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    closing_balance,
    ledger_balance,
    ledger_balance_snapshot,
    net_trade_value,
    rm_id,
    rm_name,
    department,
    account_type,
    brokerage_rate,
    interest_rate,
    created_by
  )
  SELECT
    p_eod_date,
    investor_code,
    investor_name,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    -- FIX: Closing balance uses deposits_withdrawals values only
    opening_balance + total_deposits - total_withdrawals + gross_sell - gross_buy - total_commission as closing_balance,
    opening_balance + total_deposits - total_withdrawals + gross_sell - gross_buy - total_commission as ledger_balance,
    ledger_balance_snapshot,
    gross_sell - gross_buy as net_trade_value,
    rm_id,
    rm_name,
    department,
    account_type,
    brokerage_rate,
    interest_rate,
    auth.uid()
  FROM final_calc;

  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(ledger_balance), 0),
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

  -- Record in run history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    trade_files_count,
    deposit_records_count,
    status,
    notes
  ) VALUES (
    p_eod_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_inserted_count,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_trade_files_count,
    v_deposit_records_count,
    'completed',
    'Batch EOD run with deposits_withdrawals as sole source'
  );

  RETURN jsonb_build_object(
    'success', true,
    'clients_captured', v_inserted_count,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', SQLSTATE,
    'clients_captured', 0
  );
END;
$function$;