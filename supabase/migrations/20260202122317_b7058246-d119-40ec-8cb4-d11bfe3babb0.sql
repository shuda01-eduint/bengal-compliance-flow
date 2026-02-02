-- Drop the existing function (if any) with wrong signature first
DROP FUNCTION IF EXISTS public.auto_create_missing_investors(date);

-- Create function to auto-create missing investors referenced by staging data
CREATE OR REPLACE FUNCTION public.auto_create_missing_investors(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count integer := 0;
  v_user_id uuid;
  v_sample_codes text[] := '{}';
BEGIN
  v_user_id := auth.uid();

  -- Only admins can generate master investor records
  IF v_user_id IS NOT NULL AND NOT public.has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;

  -- Insert missing investors found in trade_file or cash_ledger_txn for the given date
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
  )
  INSERT INTO public.investors (
    investor_code,
    investor_name,
    brokerage_commission,
    status,
    created_at,
    updated_at
  )
  SELECT
    m.investor_code,
    'Pending Update',
    0.004,
    'Auto-Created',
    now(),
    now()
  FROM missing m
  ON CONFLICT (investor_code) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- Collect sample codes of remaining unmatched (should be zero after insert, but just in case)
  SELECT ARRAY(
    SELECT investor_code
    FROM (
      SELECT DISTINCT NULLIF(TRIM(tf.investor_code), '') AS investor_code
      FROM public.trade_file tf
      LEFT JOIN public.investors i ON i.investor_code = tf.investor_code
      WHERE tf.trade_date = p_trade_date
        AND i.investor_code IS NULL
        AND tf.investor_code IS NOT NULL
      LIMIT 10
    ) sub
  ) INTO v_sample_codes;

  RETURN jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'inserted_investors', v_inserted_count,
    'sample_codes', COALESCE(v_sample_codes, '{}')
  );
END;
$$;

-- Grant execute to authenticated users; the function itself enforces admin check
GRANT EXECUTE ON FUNCTION public.auto_create_missing_investors(date) TO authenticated;
