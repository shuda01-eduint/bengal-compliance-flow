-- Update get_negative_balance_codes to only return CASH accounts with negative balances
DROP FUNCTION IF EXISTS get_negative_balance_codes(date, date, text);

CREATE OR REPLACE FUNCTION get_negative_balance_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  closing_balance numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.eod_date AS event_date,
    e.investor_code AS client_code,
    e.investor_name AS client_name,
    COALESCE(e.rm_name, e.rm_email, 'N/A') AS rm_name,
    e.ledger_balance AS closing_balance
  FROM eod_ledger_snapshots e
  WHERE e.ledger_balance < 0
    AND (e.account_type IS NULL OR LOWER(e.account_type) = 'cash' OR e.account_type = '')
    AND (p_from_date IS NULL OR e.eod_date >= p_from_date)
    AND (p_to_date IS NULL OR e.eod_date <= p_to_date)
    AND (
      p_search = '' OR p_search IS NULL
      OR e.investor_code ILIKE '%' || p_search || '%'
      OR e.investor_name ILIKE '%' || p_search || '%'
      OR e.rm_email ILIKE '%' || p_search || '%'
      OR e.rm_name ILIKE '%' || p_search || '%'
    )
  ORDER BY e.eod_date DESC, e.ledger_balance ASC;
END;
$$ LANGUAGE plpgsql STABLE;