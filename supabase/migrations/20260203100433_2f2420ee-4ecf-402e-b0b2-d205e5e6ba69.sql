-- Fix auto_create_missing_investors: remove invalid bi.rm_name reference
-- The investors table doesn't have rm_name column, only balances_raw does

CREATE OR REPLACE FUNCTION public.auto_create_missing_investors(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_inserted_count integer := 0;
  v_user_id uuid;
  v_sample_codes text[] := '{}';
  v_baseline_date date := '2026-01-31'::date;
BEGIN
  v_user_id := auth.uid();

  -- Only admins can generate master investor records
  IF v_user_id IS NOT NULL AND NOT public.has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;

  -- Insert missing investors found in trade_file or cash_ledger_txn for the given date
  -- Enrich with baseline data from balances_raw (31 Jan 2026) + existing investors table
  WITH codes AS (
    SELECT DISTINCT NULLIF(TRIM(investor_code), '') AS investor_code
    FROM public.trade_file
    WHERE trade_date = p_trade_date

    UNION

    SELECT DISTINCT NULLIF(TRIM(investor_code), '') AS investor_code
    FROM public.cash_ledger_txn
    WHERE txn_date = p_trade_date
  ), missing AS (
    SELECT c.investor_code
    FROM codes c
    LEFT JOIN public.investors i ON i.investor_code = c.investor_code
    WHERE c.investor_code IS NOT NULL
      AND i.investor_code IS NULL
  ), baseline_balances AS (
    -- Get ledger balance and RM info from balances_raw for 2026-01-31
    SELECT DISTINCT ON (br.investor_code)
      br.investor_code,
      br.ledger_balance,
      br.rm_name,
      br.rm_id,
      br.rm_email
    FROM public.balances_raw br
    WHERE br.as_of_date = v_baseline_date
    ORDER BY br.investor_code, br.ledger_balance DESC NULLS LAST
  ), baseline_investors AS (
    -- Get commission, interest, department, name from existing investors
    SELECT 
      inv.investor_code,
      inv.investor_name,
      inv.brokerage_commission,
      inv.interest_rate,
      inv.department,
      inv.account_type
    FROM public.investors inv
  ), enriched_baseline AS (
    -- Combine balances_raw data with investors data
    -- rm_name comes from balances_raw (bb), NOT investors table
    SELECT 
      bb.investor_code AS code,
      COALESCE(bi.investor_name, 'Pending Update') AS investor_name,
      bb.ledger_balance,
      bi.brokerage_commission AS commission_rate,
      bi.interest_rate AS accrued_interest,
      bb.rm_name,  -- from balances_raw only
      bb.rm_id,    -- from balances_raw only
      bi.department,
      bi.account_type
    FROM baseline_balances bb
    LEFT JOIN baseline_investors bi ON bi.investor_code = bb.investor_code
  )
  INSERT INTO public.investors (
    investor_code,
    investor_name,
    ledger_balance,
    brokerage_commission,
    interest_rate,
    rm_name,
    rm_id,
    department,
    account_type,
    status,
    created_at,
    updated_at
  )
  SELECT
    m.investor_code,
    COALESCE(b.investor_name, 'Pending Update'),
    COALESCE(b.ledger_balance, 0),
    COALESCE(b.commission_rate, 0.004),
    COALESCE(b.accrued_interest, 0),
    b.rm_name,
    b.rm_id,
    b.department,
    b.account_type,
    CASE WHEN b.code IS NOT NULL THEN 'Auto-Created' ELSE 'Unknown' END,
    now(),
    now()
  FROM missing m
  LEFT JOIN enriched_baseline b ON b.code = m.investor_code
  ON CONFLICT (investor_code) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- Collect sample codes of newly inserted records
  SELECT ARRAY(
    SELECT investor_code
    FROM (
      SELECT DISTINCT i.investor_code
      FROM public.investors i
      WHERE i.status IN ('Auto-Created', 'Unknown')
        AND i.created_at >= now() - interval '1 minute'
      ORDER BY i.investor_code
      LIMIT 10
    ) sub
  ) INTO v_sample_codes;

  RETURN jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'inserted_count', v_inserted_count,
    'sample_codes', COALESCE(v_sample_codes, '{}')
  );
END;
$$;