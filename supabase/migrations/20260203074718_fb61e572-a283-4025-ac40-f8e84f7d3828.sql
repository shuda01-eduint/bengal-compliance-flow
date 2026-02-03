-- Fix margin exclusion filter: exclude 'Margin' (not just 'M')
-- Both RPCs updated to use upper(trim(inv.account_type)) NOT IN ('M', 'MARGIN')

CREATE OR REPLACE FUNCTION public.get_all_negative_cash_balances(p_target_date date DEFAULT NULL)
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
  -- Date snapping: find latest available snapshot date <= requested date
  v_requested_dt := COALESCE(p_target_date, CURRENT_DATE);
  SELECT MAX(eod_date)::date INTO v_target_dt
  FROM public.eod_ledger_snapshots
  WHERE eod_date <= v_requested_dt;

  IF v_target_dt IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    els.eod_date AS event_date,
    els.investor_code AS client_code,
    COALESCE(inv.investor_name, els.investor_name, '') AS client_name,
    COALESCE(inv.rm_name, els.rm_name, '') AS rm_name,
    els.closing_balance,
    COALESCE(
      (SELECT (v_target_dt - MIN(h.eod_date))::integer + 1
       FROM public.eod_ledger_snapshots h
       WHERE h.investor_code = els.investor_code
         AND h.closing_balance < 0
         AND h.eod_date <= v_target_dt),
      1
    ) AS days_negative,
    COALESCE(inv.department, '') AS department
  FROM public.eod_ledger_snapshots els
  LEFT JOIN public.investors inv ON inv.investor_code = els.investor_code
  WHERE els.eod_date = v_target_dt
    AND els.closing_balance < 0
    -- Exclude margin accounts: check both investors table and snapshot
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
$$;

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
  v_requested_dt date;
  v_target_dt date;
  v_lookback_dt date;
BEGIN
  -- Date snapping: find latest available snapshot date <= requested date
  v_requested_dt := COALESCE(p_to_date, CURRENT_DATE);
  SELECT MAX(eod_date)::date INTO v_target_dt
  FROM public.eod_ledger_snapshots
  WHERE eod_date <= v_requested_dt;

  IF v_target_dt IS NULL THEN
    RETURN;
  END IF;

  v_lookback_dt := v_target_dt - p_lookback_days;

  RETURN QUERY
  WITH current_negative AS (
    SELECT
      els.investor_code,
      els.closing_balance AS current_balance,
      els.investor_name AS snapshot_name,
      els.rm_name AS snapshot_rm,
      els.account_type AS snapshot_account_type
    FROM public.eod_ledger_snapshots els
    WHERE els.eod_date = v_target_dt
      AND els.closing_balance < 0
      AND (
        els.account_type IS NULL
        OR trim(els.account_type) = ''
        OR upper(trim(els.account_type)) NOT IN ('M', 'MARGIN')
      )
  ),
  lookback_balance AS (
    SELECT
      els.investor_code,
      els.closing_balance AS prev_balance
    FROM public.eod_ledger_snapshots els
    WHERE els.eod_date = v_lookback_dt
  )
  SELECT
    v_target_dt AS event_date,
    cn.investor_code AS client_code,
    COALESCE(inv.investor_name, cn.snapshot_name, '') AS client_name,
    COALESCE(inv.rm_name, cn.snapshot_rm, '') AS rm_name,
    cn.current_balance AS closing_balance,
    COALESCE(lb.prev_balance, 0) AS previous_balance,
    COALESCE(
      (SELECT (v_target_dt - MIN(h.eod_date))::integer + 1
       FROM public.eod_ledger_snapshots h
       WHERE h.investor_code = cn.investor_code
         AND h.closing_balance < 0
         AND h.eod_date <= v_target_dt),
      1
    ) AS days_negative,
    COALESCE(inv.department, '') AS department
  FROM current_negative cn
  LEFT JOIN public.investors inv ON inv.investor_code = cn.investor_code
  LEFT JOIN lookback_balance lb ON lb.investor_code = cn.investor_code
  WHERE
    -- Only include accounts that turned negative (were non-negative in lookback)
    (lb.prev_balance IS NULL OR lb.prev_balance >= 0)
    -- Exclude margin accounts from investors table
    AND (
      inv.account_type IS NULL
      OR trim(inv.account_type) = ''
      OR upper(trim(inv.account_type)) NOT IN ('M', 'MARGIN')
    )
    -- Exclude closed accounts
    AND (inv.status IS NULL OR upper(trim(inv.status)) != 'CLOSED')
    -- Optional search filter
    AND (
      p_search = ''
      OR cn.investor_code ILIKE '%' || p_search || '%'
      OR COALESCE(inv.investor_name, cn.snapshot_name, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY cn.current_balance ASC;
END;
$$;