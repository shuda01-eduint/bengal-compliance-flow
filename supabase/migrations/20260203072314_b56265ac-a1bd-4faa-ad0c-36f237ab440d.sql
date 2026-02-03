CREATE OR REPLACE FUNCTION public.get_negative_balance_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_search text DEFAULT '',
  p_lookback_days integer DEFAULT 7
)
RETURNS TABLE(
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric,
  previous_balance numeric,
  days_negative integer,
  department text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_end_dt date;
  v_end_dt date;
  v_start_dt date;
BEGIN
  -- Use requested end date (default to today), but snap to latest available EOD date <= requested
  v_requested_end_dt := COALESCE(p_to_date, CURRENT_DATE);
  SELECT MAX(eod_date)::date
    INTO v_end_dt
  FROM public.eod_ledger_snapshots
  WHERE eod_date <= v_requested_end_dt;

  IF v_end_dt IS NULL THEN
    -- No data at/earlier than requested; fall back to latest available date overall
    SELECT MAX(eod_date)::date INTO v_end_dt FROM public.eod_ledger_snapshots;
  END IF;

  IF v_end_dt IS NULL THEN
    RETURN; -- no snapshot data at all
  END IF;

  v_start_dt := v_end_dt - p_lookback_days;

  RETURN QUERY
  WITH current_balances AS (
    SELECT 
      els.investor_code,
      els.investor_name,
      els.rm_name,
      els.closing_balance as current_bal,
      els.eod_date as current_date,
      inv.department as inv_department
    FROM public.eod_ledger_snapshots els
    INNER JOIN public.investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date = v_end_dt
      AND els.closing_balance < 0
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
      AND (inv.status IS NULL OR inv.status != 'CLOSED')
  ),
  previous_balances AS (
    SELECT DISTINCT ON (els.investor_code)
      els.investor_code,
      els.closing_balance as prev_bal
    FROM public.eod_ledger_snapshots els
    INNER JOIN public.investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date <= v_start_dt
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
    ORDER BY els.investor_code, els.eod_date DESC
  ),
  first_negative AS (
    SELECT 
      els.investor_code,
      MIN(els.eod_date) as first_negative_date
    FROM public.eod_ledger_snapshots els
    INNER JOIN public.investors inv ON inv.investor_code = els.investor_code
    WHERE els.closing_balance < 0
      AND els.eod_date >= v_start_dt
      AND els.eod_date <= v_end_dt
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
    GROUP BY els.investor_code
  )
  SELECT 
    cb.current_date as event_date,
    cb.investor_code as client_code,
    COALESCE(cb.investor_name, '') as client_name,
    COALESCE(cb.rm_name, '') as rm_name,
    cb.current_bal as closing_balance,
    COALESCE(pb.prev_bal, 0) as previous_balance,
    (v_end_dt - COALESCE(fn.first_negative_date, cb.current_date))::integer as days_negative,
    COALESCE(cb.inv_department, '') as department
  FROM current_balances cb
  LEFT JOIN previous_balances pb ON pb.investor_code = cb.investor_code
  LEFT JOIN first_negative fn ON fn.investor_code = cb.investor_code
  WHERE 
    COALESCE(pb.prev_bal, 0) >= 0
    AND (p_search = '' OR cb.investor_code ILIKE '%' || p_search || '%' OR cb.investor_name ILIKE '%' || p_search || '%')
  ORDER BY cb.current_bal ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_all_negative_cash_balances(
  p_target_date date DEFAULT NULL
)
RETURNS TABLE(
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric,
  days_negative integer,
  department text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_dt date;
  v_target_dt date;
BEGIN
  -- Snap requested date to latest available EOD date <= requested
  v_requested_dt := COALESCE(p_target_date, CURRENT_DATE);
  SELECT MAX(eod_date)::date
    INTO v_target_dt
  FROM public.eod_ledger_snapshots
  WHERE eod_date <= v_requested_dt;

  IF v_target_dt IS NULL THEN
    SELECT MAX(eod_date)::date INTO v_target_dt FROM public.eod_ledger_snapshots;
  END IF;

  IF v_target_dt IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH current_negatives AS (
    SELECT 
      els.investor_code,
      els.investor_name,
      els.rm_name,
      els.closing_balance as current_bal,
      els.eod_date,
      inv.department as inv_department
    FROM public.eod_ledger_snapshots els
    INNER JOIN public.investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date = v_target_dt
      AND els.closing_balance < 0
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
      AND (inv.status IS NULL OR inv.status != 'CLOSED')
  ),
  first_negative_dates AS (
    -- Accurate first-negative date (bounded to current negatives only)
    SELECT 
      els.investor_code,
      MIN(els.eod_date) as first_negative_date
    FROM public.eod_ledger_snapshots els
    INNER JOIN current_negatives cn ON cn.investor_code = els.investor_code
    WHERE els.closing_balance < 0
      AND els.eod_date <= v_target_dt
    GROUP BY els.investor_code
  )
  SELECT 
    cn.eod_date as event_date,
    cn.investor_code as client_code,
    COALESCE(cn.investor_name, '') as client_name,
    COALESCE(cn.rm_name, '') as rm_name,
    cn.current_bal as closing_balance,
    (v_target_dt - COALESCE(fnd.first_negative_date, cn.eod_date))::integer as days_negative,
    COALESCE(cn.inv_department, '') as department
  FROM current_negatives cn
  LEFT JOIN first_negative_dates fnd ON fnd.investor_code = cn.investor_code
  ORDER BY cn.current_bal ASC;
END;
$$;