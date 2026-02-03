-- Drop existing functions first (return type changed - removed days_negative)
DROP FUNCTION IF EXISTS public.get_all_negative_cash_balances(date);
DROP FUNCTION IF EXISTS public.get_negative_balance_codes(date, date, text, integer);

-- 1. Simplified "All" mode RPC
CREATE FUNCTION public.get_all_negative_cash_balances(
  p_target_date date DEFAULT NULL::date
)
RETURNS TABLE(
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric,
  department text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target_dt date;
BEGIN
  v_target_dt := COALESCE(p_target_date, CURRENT_DATE);

  RETURN QUERY
  SELECT
    els.eod_date AS event_date,
    els.investor_code AS client_code,
    COALESCE(inv.investor_name, els.investor_name, '') AS client_name,
    COALESCE(inv.rm_name, els.rm_name, '') AS rm_name,
    els.closing_balance,
    COALESCE(inv.department, '') AS department
  FROM public.eod_ledger_snapshots els
  LEFT JOIN public.investors inv ON inv.investor_code = els.investor_code
  WHERE els.eod_date = v_target_dt
    AND els.closing_balance < 0
    -- Exclude margin accounts
    AND (
      inv.account_type IS NULL
      OR trim(inv.account_type) = ''
      OR upper(trim(inv.account_type)) NOT IN ('M', 'MARGIN')
    )
    AND (
      els.account_type IS NULL
      OR trim(els.account_type) = ''
      OR upper(trim(els.account_type)) NOT IN ('M', 'MARGIN')
    )
    -- Exclude closed accounts
    AND (inv.status IS NULL OR upper(trim(inv.status)) != 'CLOSED')
  ORDER BY els.closing_balance ASC;
END;
$function$;

-- 2. Simplified "New Only" mode RPC - simple join between from_date and to_date
CREATE FUNCTION public.get_negative_balance_codes(
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date,
  p_search text DEFAULT ''::text,
  p_lookback_days integer DEFAULT 7
)
RETURNS TABLE(
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric,
  previous_balance numeric,
  department text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from_dt date;
  v_to_dt date;
BEGIN
  v_to_dt := COALESCE(p_to_date, CURRENT_DATE);
  v_from_dt := COALESCE(p_from_date, v_to_dt - p_lookback_days);

  RETURN QUERY
  SELECT
    curr.eod_date AS event_date,
    curr.investor_code AS client_code,
    COALESCE(inv.investor_name, curr.investor_name, '') AS client_name,
    COALESCE(inv.rm_name, curr.rm_name, '') AS rm_name,
    curr.closing_balance,
    COALESCE(prev.closing_balance, 0) AS previous_balance,
    COALESCE(inv.department, '') AS department
  FROM public.eod_ledger_snapshots curr
  LEFT JOIN public.eod_ledger_snapshots prev 
    ON prev.investor_code = curr.investor_code 
    AND prev.eod_date = v_from_dt
  LEFT JOIN public.investors inv ON inv.investor_code = curr.investor_code
  WHERE curr.eod_date = v_to_dt
    AND curr.closing_balance < 0
    -- Only show accounts that turned negative (were non-negative on from_date)
    AND (prev.closing_balance IS NULL OR prev.closing_balance >= 0)
    -- Exclude margin accounts
    AND (
      inv.account_type IS NULL
      OR trim(inv.account_type) = ''
      OR upper(trim(inv.account_type)) NOT IN ('M', 'MARGIN')
    )
    AND (
      curr.account_type IS NULL
      OR trim(curr.account_type) = ''
      OR upper(trim(curr.account_type)) NOT IN ('M', 'MARGIN')
    )
    -- Exclude closed accounts
    AND (inv.status IS NULL OR upper(trim(inv.status)) != 'CLOSED')
    -- Optional search filter
    AND (
      p_search = ''
      OR curr.investor_code ILIKE '%' || p_search || '%'
      OR COALESCE(inv.investor_name, curr.investor_name, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY curr.closing_balance ASC;
END;
$function$;