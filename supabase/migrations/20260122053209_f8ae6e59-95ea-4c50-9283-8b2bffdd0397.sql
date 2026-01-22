-- Step 1: Add RM fields to investors master table
ALTER TABLE public.investors
  ADD COLUMN IF NOT EXISTS rm_id text,
  ADD COLUMN IF NOT EXISTS rm_name text,
  ADD COLUMN IF NOT EXISTS department text;

-- Create index for RM filtering
CREATE INDEX IF NOT EXISTS idx_investors_rm_id ON public.investors(rm_id);

-- Step 2: Add RM fields to EOD snapshots table
ALTER TABLE public.eod_ledger_snapshots
  ADD COLUMN IF NOT EXISTS rm_id text,
  ADD COLUMN IF NOT EXISTS rm_name text,
  ADD COLUMN IF NOT EXISTS department text;

-- Step 3: Backfill investors from balances_raw (latest snapshot per investor)
UPDATE public.investors i
SET 
  rm_id = br.rm_id,
  rm_name = br.rm_name,
  department = e.department
FROM (
  SELECT DISTINCT ON (investor_code) 
    investor_code, rm_id, rm_name
  FROM balances_raw
  WHERE rm_id IS NOT NULL 
    AND rm_id != 'General or Resigned Employee'
  ORDER BY investor_code, as_of_date DESC
) br
LEFT JOIN employees e ON br.rm_id = e.employee_id
WHERE UPPER(i.investor_code) = UPPER(br.investor_code);

-- Step 4: Update run_batch_eod function to include RM fields
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
AS $$
DECLARE
  v_start_time timestamptz := clock_timestamp();
  v_processed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_user_email text;
  v_prev_date date;
BEGIN
  -- Check admin role
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Get user email for audit
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Calculate previous business date
  v_prev_date := p_eod_date - 1;

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed', 0,
      'skipped', 1,
      'message', 'EOD already exists for this date',
      'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000
    );
  END IF;

  -- Main EOD processing using set-based operations
  WITH 
  -- Get all investors from master table with RM info
  inv AS (
    SELECT
      UPPER(i.investor_code) AS investor_code,
      i.investor_name,
      COALESCE(i.ledger_balance, 0) AS base_balance,
      COALESCE(i.brokerage_commission, 0.4) AS brokerage_commission_raw,
      COALESCE(i.account_type, 'Regular') AS account_type,
      COALESCE(i.interest_rate, 0) AS interest_rate,
      COALESCE(i.rm_id, '') AS rm_id,
      COALESCE(i.rm_name, '') AS rm_name,
      COALESCE(i.department, '') AS department
    FROM public.investors i
    WHERE i.investor_code IS NOT NULL
  ),
  
  -- Get previous day closing balances
  prev_eod AS (
    SELECT 
      investor_code,
      closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  
  -- Aggregate trades for the EOD date
  trades AS (
    SELECT
      UPPER(client_code) AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN total_value ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN total_value ELSE 0 END), 0) AS gross_sell
    FROM trade_history
    WHERE trade_date = p_eod_date
    GROUP BY UPPER(client_code)
  ),
  
  -- Aggregate deposits/withdrawals for the EOD date
  txns AS (
    SELECT
      UPPER(investor_code) AS investor_code,
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY UPPER(investor_code)
  ),
  
  -- Build universe of all investors with activity
  universe AS (
    SELECT investor_code FROM inv
    UNION
    SELECT investor_code FROM trades
    UNION
    SELECT investor_code FROM txns
    UNION
    SELECT investor_code FROM prev_eod
  ),
  
  -- Calculate final values for each investor
  final AS (
    SELECT
      u.investor_code,
      COALESCE(inv.investor_name, '') AS investor_name,
      COALESCE(inv.account_type, 'Regular') AS account_type,
      COALESCE(inv.interest_rate, 0) AS interest_rate,
      COALESCE(inv.brokerage_commission_raw, 0.4) AS brokerage_rate,
      COALESCE(inv.rm_id, '') AS rm_id,
      COALESCE(inv.rm_name, '') AS rm_name,
      COALESCE(inv.department, '') AS department,
      -- Opening balance: previous EOD closing or base balance
      COALESCE(prev.closing_balance, inv.base_balance, 0) AS opening_balance,
      COALESCE(txns.total_deposits, 0) AS total_deposits,
      COALESCE(txns.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(trades.gross_buy, 0) AS gross_buy,
      COALESCE(trades.gross_sell, 0) AS gross_sell,
      -- Commission = turnover * (brokerage_rate / 100)
      ROUND(
        (COALESCE(trades.gross_buy, 0) + COALESCE(trades.gross_sell, 0)) * 
        (COALESCE(inv.brokerage_commission_raw, 0.4) / 100),
        2
      ) AS total_commission,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Commission
      ROUND(
        COALESCE(prev.closing_balance, inv.base_balance, 0)
        + COALESCE(txns.total_deposits, 0)
        - COALESCE(txns.total_withdrawals, 0)
        + COALESCE(trades.gross_sell, 0)
        - COALESCE(trades.gross_buy, 0)
        - ROUND(
            (COALESCE(trades.gross_buy, 0) + COALESCE(trades.gross_sell, 0)) * 
            (COALESCE(inv.brokerage_commission_raw, 0.4) / 100),
            2
          ),
        2
      ) AS closing_balance
    FROM universe u
    LEFT JOIN inv ON u.investor_code = inv.investor_code
    LEFT JOIN prev_eod prev ON u.investor_code = prev.investor_code
    LEFT JOIN trades ON u.investor_code = trades.investor_code
    LEFT JOIN txns ON u.investor_code = txns.investor_code
  ),
  
  -- Insert/update snapshots
  upserted AS (
    INSERT INTO public.eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      account_type,
      interest_rate,
      brokerage_rate,
      opening_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      closing_balance,
      ledger_balance,
      rm_id,
      rm_name,
      department
    )
    SELECT
      p_eod_date,
      f.investor_code,
      f.investor_name,
      f.account_type,
      f.interest_rate,
      f.brokerage_rate,
      f.opening_balance,
      f.total_deposits,
      f.total_withdrawals,
      f.gross_buy,
      f.gross_sell,
      f.total_commission,
      f.closing_balance,
      f.closing_balance,
      f.rm_id,
      f.rm_name,
      f.department
    FROM final f
    ON CONFLICT (eod_date, investor_code) DO UPDATE SET
      investor_name = EXCLUDED.investor_name,
      account_type = EXCLUDED.account_type,
      interest_rate = EXCLUDED.interest_rate,
      brokerage_rate = EXCLUDED.brokerage_rate,
      opening_balance = EXCLUDED.opening_balance,
      total_deposits = EXCLUDED.total_deposits,
      total_withdrawals = EXCLUDED.total_withdrawals,
      gross_buy = EXCLUDED.gross_buy,
      gross_sell = EXCLUDED.gross_sell,
      total_commission = EXCLUDED.total_commission,
      closing_balance = EXCLUDED.closing_balance,
      ledger_balance = EXCLUDED.ledger_balance,
      rm_id = EXCLUDED.rm_id,
      rm_name = EXCLUDED.rm_name,
      department = EXCLUDED.department,
      updated_at = now()
    RETURNING investor_code
  )
  SELECT COUNT(*) INTO v_processed FROM upserted;

  -- Log the run in history
  INSERT INTO eod_run_history (
    run_date,
    run_at,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission
  )
  SELECT
    p_eod_date,
    now(),
    v_user_email,
    COUNT(*),
    SUM(closing_balance),
    SUM(total_deposits),
    SUM(total_withdrawals),
    SUM(gross_buy),
    SUM(gross_sell),
    SUM(total_commission)
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'processed', v_processed,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000
  );
END;
$$;