-- Update get_negative_balance_codes to sort by most negative balance first
CREATE OR REPLACE FUNCTION public.get_negative_balance_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_search text DEFAULT ''
)
RETURNS TABLE(
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.eod_date as event_date,
    e.investor_code as client_code,
    COALESCE(e.investor_name, c.investor_name, '') as client_name,
    COALESCE(e.rm_name, c.rm_name, '') as rm_name,
    e.ledger_balance as closing_balance
  FROM eod_ledger_snapshots e
  LEFT JOIN clients c ON c.inv_code = e.investor_code
  WHERE e.ledger_balance < 0
    AND (e.account_type IS NULL OR LOWER(e.account_type) = 'cash' OR e.account_type = '')
    -- Exclude closed accounts: only include Active or Suspended
    AND (c.status IS NULL OR UPPER(c.status) IN ('ACTIVE', 'SUSPENDED'))
    AND (p_from_date IS NULL OR e.eod_date >= p_from_date)
    AND (p_to_date IS NULL OR e.eod_date <= p_to_date)
    AND (
      p_search = '' 
      OR e.investor_code ILIKE '%' || p_search || '%'
      OR COALESCE(e.investor_name, c.investor_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(e.rm_name, c.rm_name, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY e.ledger_balance ASC, e.eod_date DESC, e.investor_code;
END;
$$;