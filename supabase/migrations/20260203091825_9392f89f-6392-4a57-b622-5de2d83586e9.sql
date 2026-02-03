-- Create admin_balances table for baseline data imports
CREATE TABLE public.admin_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  investor_name text,
  ledger_balance numeric DEFAULT 0,
  commission_rate numeric DEFAULT 0.004,
  accrued_interest numeric DEFAULT 0,
  market_value numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  rm_name text,
  rm_id text,
  department text,
  account_type text,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(code, as_of_date)
);

-- Create index for fast lookups
CREATE INDEX idx_admin_balances_code ON public.admin_balances(code);
CREATE INDEX idx_admin_balances_as_of_date ON public.admin_balances(as_of_date);

-- Enable RLS
ALTER TABLE public.admin_balances ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage admin_balances"
  ON public.admin_balances
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view admin_balances"
  ON public.admin_balances
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_approved = true
  ));

-- Update auto_create_missing_investors to use admin_balances baseline data
CREATE OR REPLACE FUNCTION public.auto_create_missing_investors(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
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
  -- Enrich with baseline data from admin_balances (31 Jan 2026)
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
  ), baseline AS (
    SELECT 
      ab.code,
      ab.investor_name,
      ab.ledger_balance,
      ab.commission_rate,
      ab.accrued_interest,
      ab.rm_name,
      ab.rm_id,
      ab.department,
      ab.account_type
    FROM public.admin_balances ab
    WHERE ab.as_of_date = v_baseline_date
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
  LEFT JOIN baseline b ON b.code = m.investor_code
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
$function$;