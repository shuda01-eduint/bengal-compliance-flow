-- Create RPC function to detect over-buy margin violations
CREATE OR REPLACE FUNCTION public.get_over_buy_margin_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  client_code text,
  client_name text,
  rm_name text,
  opening_balance numeric,
  closing_balance numeric,
  loan_increase numeric,
  first_date date,
  last_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT 
      COALESCE(p_from_date, CURRENT_DATE - INTERVAL '30 days')::date as start_dt,
      COALESCE(p_to_date, CURRENT_DATE)::date as end_dt
  ),
  first_last_balances AS (
    SELECT 
      e.investor_code,
      FIRST_VALUE(e.ledger_balance) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as opening_bal,
      FIRST_VALUE(e.ledger_balance) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date DESC
      ) as closing_bal,
      FIRST_VALUE(e.eod_date) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as first_dt,
      FIRST_VALUE(e.eod_date) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date DESC
      ) as last_dt,
      ROW_NUMBER() OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as rn
    FROM eod_ledger_snapshots e
    CROSS JOIN date_range d
    WHERE LOWER(e.account_type) = 'margin'
      AND e.eod_date >= d.start_dt
      AND e.eod_date <= d.end_dt
  )
  SELECT 
    f.investor_code as client_code,
    COALESCE(i.investor_name, '') as client_name,
    COALESCE(i.rm_name, '') as rm_name,
    f.opening_bal as opening_balance,
    f.closing_bal as closing_balance,
    (ABS(f.closing_bal) - ABS(f.opening_bal)) as loan_increase,
    f.first_dt as first_date,
    f.last_dt as last_date
  FROM first_last_balances f
  LEFT JOIN investors i ON i.investor_code = f.investor_code
  WHERE f.rn = 1
    AND f.closing_bal < 0
    AND f.opening_bal < 0
    AND f.closing_bal < f.opening_bal  -- Loan increased (more negative)
    AND (i.status IS NULL OR UPPER(i.status) NOT IN ('CLOSED'))
  ORDER BY (ABS(f.closing_bal) - ABS(f.opening_bal)) DESC;
END;
$$;