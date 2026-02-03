
-- Update get_negative_balance_codes to detect NEWLY created negative balances
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
  days_negative integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_end_dt date;
  v_lookback_dt date;
BEGIN
  -- Set default dates
  v_end_dt := COALESCE(p_to_date, CURRENT_DATE);
  
  -- Calculate lookback date
  v_lookback_dt := COALESCE(p_from_date, v_end_dt - (COALESCE(p_lookback_days, 7) || ' days')::interval);
  
  RETURN QUERY
  WITH current_balances AS (
    -- Get the current/closing balance for each account on or before to_date
    SELECT DISTINCT ON (e.investor_code)
      e.investor_code,
      e.ledger_balance as current_bal,
      e.eod_date as current_date,
      e.investor_name,
      e.rm_name
    FROM eod_ledger_snapshots e
    WHERE (LOWER(e.account_type) = 'cash' OR e.account_type IS NULL OR e.account_type = '')
      AND e.eod_date <= v_end_dt
    ORDER BY e.investor_code, e.eod_date DESC
  ),
  previous_balances AS (
    -- Get the balance from the lookback period start
    SELECT DISTINCT ON (e.investor_code)
      e.investor_code,
      e.ledger_balance as prev_bal,
      e.eod_date as prev_date
    FROM eod_ledger_snapshots e
    WHERE (LOWER(e.account_type) = 'cash' OR e.account_type IS NULL OR e.account_type = '')
      AND e.eod_date <= v_lookback_dt
    ORDER BY e.investor_code, e.eod_date DESC
  ),
  first_negative AS (
    -- Find when the account first became negative in the period
    SELECT 
      e.investor_code,
      MIN(e.eod_date) as first_negative_date
    FROM eod_ledger_snapshots e
    WHERE (LOWER(e.account_type) = 'cash' OR e.account_type IS NULL OR e.account_type = '')
      AND e.eod_date > v_lookback_dt
      AND e.eod_date <= v_end_dt
      AND e.ledger_balance < 0
    GROUP BY e.investor_code
  )
  SELECT 
    cb.current_date as event_date,
    cb.investor_code as client_code,
    COALESCE(cb.investor_name, i.investor_name, '') as client_name,
    COALESCE(cb.rm_name, i.rm_name, '') as rm_name,
    cb.current_bal as closing_balance,
    COALESCE(pb.prev_bal, 0) as previous_balance,
    (v_end_dt - COALESCE(fn.first_negative_date, cb.current_date))::integer as days_negative
  FROM current_balances cb
  LEFT JOIN previous_balances pb ON pb.investor_code = cb.investor_code
  LEFT JOIN first_negative fn ON fn.investor_code = cb.investor_code
  LEFT JOIN investors i ON i.investor_code = cb.investor_code
  WHERE 
    -- Current balance is negative
    cb.current_bal < 0
    -- Previous balance was zero or positive (NEWLY negative)
    AND COALESCE(pb.prev_bal, 0) >= 0
    -- Exclude closed accounts
    AND (i.status IS NULL OR UPPER(i.status) NOT IN ('CLOSED'))
    -- Apply search filter
    AND (
      p_search IS NULL 
      OR p_search = ''
      OR cb.investor_code ILIKE '%' || p_search || '%'
      OR COALESCE(cb.investor_name, i.investor_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(cb.rm_name, i.rm_name, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY cb.current_bal ASC;  -- Most negative first
END;
$$;
