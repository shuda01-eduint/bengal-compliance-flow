-- Drop the existing function and create new one with period comparison
DROP FUNCTION IF EXISTS public.get_margin_composition_by_department(date);

CREATE OR REPLACE FUNCTION public.get_margin_composition_by_department(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  department text,
  beginning_balance numeric,
  ending_balance numeric,
  change_amount numeric,
  change_percent numeric,
  client_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actual_from_date date;
  actual_to_date date;
BEGIN
  -- Get actual dates - use latest available if not specified or not found
  SELECT COALESCE(
    (SELECT br.as_of_date FROM balances_raw br WHERE br.as_of_date = p_from_date LIMIT 1),
    (SELECT MIN(br.as_of_date) FROM balances_raw br)
  ) INTO actual_from_date;
  
  SELECT COALESCE(
    (SELECT br.as_of_date FROM balances_raw br WHERE br.as_of_date = p_to_date LIMIT 1),
    (SELECT MAX(br.as_of_date) FROM balances_raw br)
  ) INTO actual_to_date;

  RETURN QUERY
  WITH beginning_balances AS (
    SELECT 
      COALESCE(e.department, 'Unknown') as dept,
      SUM(COALESCE(br.ledger_balance, 0)) as total_balance,
      COUNT(DISTINCT br.investor_code) as clients
    FROM balances_raw br
    LEFT JOIN employees e ON LOWER(e.email) = LOWER(br.rm_email)
    WHERE br.as_of_date = actual_from_date
    GROUP BY COALESCE(e.department, 'Unknown')
  ),
  ending_balances AS (
    SELECT 
      COALESCE(e.department, 'Unknown') as dept,
      SUM(COALESCE(br.ledger_balance, 0)) as total_balance,
      COUNT(DISTINCT br.investor_code) as clients
    FROM balances_raw br
    LEFT JOIN employees e ON LOWER(e.email) = LOWER(br.rm_email)
    WHERE br.as_of_date = actual_to_date
    GROUP BY COALESCE(e.department, 'Unknown')
  )
  SELECT 
    COALESCE(bb.dept, eb.dept) as department,
    COALESCE(bb.total_balance, 0) as beginning_balance,
    COALESCE(eb.total_balance, 0) as ending_balance,
    COALESCE(eb.total_balance, 0) - COALESCE(bb.total_balance, 0) as change_amount,
    CASE 
      WHEN COALESCE(bb.total_balance, 0) != 0 
      THEN ((COALESCE(eb.total_balance, 0) - COALESCE(bb.total_balance, 0)) / ABS(bb.total_balance)) * 100
      ELSE 0
    END as change_percent,
    GREATEST(COALESCE(bb.clients, 0), COALESCE(eb.clients, 0)) as client_count
  FROM beginning_balances bb
  FULL OUTER JOIN ending_balances eb ON bb.dept = eb.dept
  ORDER BY ABS(COALESCE(eb.total_balance, 0) - COALESCE(bb.total_balance, 0)) DESC;
END;
$function$;