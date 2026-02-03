-- Drop the existing function first since return type is changing
DROP FUNCTION IF EXISTS public.get_negative_balance_codes(date, date, text, integer);

-- Recreate with new return type including department
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
  v_end_dt date;
  v_start_dt date;
BEGIN
  -- Set end date (default to today)
  v_end_dt := COALESCE(p_to_date, CURRENT_DATE);
  
  -- Set start date for lookback comparison
  v_start_dt := v_end_dt - p_lookback_days;

  RETURN QUERY
  WITH current_balances AS (
    -- Get current negative balances, join with investors to filter cash accounts only
    SELECT 
      els.investor_code,
      els.investor_name,
      els.rm_name,
      els.closing_balance as current_bal,
      els.eod_date as current_date,
      inv.department as inv_department
    FROM eod_ledger_snapshots els
    INNER JOIN investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date = v_end_dt
      AND els.closing_balance < 0
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
      AND (inv.status IS NULL OR inv.status != 'CLOSED')
  ),
  previous_balances AS (
    -- Get balances from lookback period start
    SELECT DISTINCT ON (els.investor_code)
      els.investor_code,
      els.closing_balance as prev_bal
    FROM eod_ledger_snapshots els
    INNER JOIN investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date <= v_start_dt
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
    ORDER BY els.investor_code, els.eod_date DESC
  ),
  first_negative AS (
    -- Find when the account first became negative within lookback period
    SELECT 
      els.investor_code,
      MIN(els.eod_date) as first_negative_date
    FROM eod_ledger_snapshots els
    INNER JOIN investors inv ON inv.investor_code = els.investor_code
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
    -- Only include accounts that were NOT negative before the lookback period
    COALESCE(pb.prev_bal, 0) >= 0
    -- Apply search filter if provided
    AND (p_search = '' OR cb.investor_code ILIKE '%' || p_search || '%' OR cb.investor_name ILIKE '%' || p_search || '%')
  ORDER BY cb.current_bal ASC;
END;
$$;

-- Create function to get ALL negative cash balances with days_negative calculation
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
  v_target_dt date;
BEGIN
  v_target_dt := COALESCE(p_target_date, CURRENT_DATE);

  RETURN QUERY
  WITH current_negatives AS (
    -- Get all current negative cash balances
    SELECT 
      els.investor_code,
      els.investor_name,
      els.rm_name,
      els.closing_balance as current_bal,
      els.eod_date,
      inv.department as inv_department
    FROM eod_ledger_snapshots els
    INNER JOIN investors inv ON inv.investor_code = els.investor_code
    WHERE els.eod_date = v_target_dt
      AND els.closing_balance < 0
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
      AND (inv.status IS NULL OR inv.status != 'CLOSED')
  ),
  first_negative_dates AS (
    -- Find the first date each account became negative (looking back up to 365 days)
    SELECT 
      els.investor_code,
      MIN(els.eod_date) as first_negative_date
    FROM eod_ledger_snapshots els
    INNER JOIN investors inv ON inv.investor_code = els.investor_code
    WHERE els.closing_balance < 0
      AND els.eod_date >= v_target_dt - 365
      AND els.eod_date <= v_target_dt
      AND (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
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