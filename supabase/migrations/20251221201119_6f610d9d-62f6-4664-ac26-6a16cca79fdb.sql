
-- Drop and recreate the function to show margin loan (negative balances as positive loan amounts)
DROP FUNCTION IF EXISTS public.get_margin_composition_by_department(date, date);

CREATE OR REPLACE FUNCTION public.get_margin_composition_by_department(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  department text,
  beginning_loan numeric,
  ending_loan numeric,
  loan_change numeric,
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
  -- Get the earliest date if p_from_date is NULL or not found
  IF p_from_date IS NULL THEN
    SELECT MIN(br.as_of_date) INTO actual_from_date FROM balances_raw br;
  ELSE
    -- Check if the exact date exists, if not find the closest earlier date
    SELECT MAX(br.as_of_date) INTO actual_from_date 
    FROM balances_raw br 
    WHERE br.as_of_date <= p_from_date;
    
    IF actual_from_date IS NULL THEN
      SELECT MIN(br.as_of_date) INTO actual_from_date FROM balances_raw br;
    END IF;
  END IF;
  
  -- Get the latest date if p_to_date is NULL or not found
  IF p_to_date IS NULL THEN
    SELECT MAX(br.as_of_date) INTO actual_to_date FROM balances_raw br;
  ELSE
    -- Check if the exact date exists, if not find the closest earlier date
    SELECT MAX(br.as_of_date) INTO actual_to_date 
    FROM balances_raw br 
    WHERE br.as_of_date <= p_to_date;
    
    IF actual_to_date IS NULL THEN
      SELECT MAX(br.as_of_date) INTO actual_to_date FROM balances_raw br;
    END IF;
  END IF;

  RETURN QUERY
  WITH from_balances AS (
    -- Get margin loans (negative balances) per investor at start date
    SELECT 
      br.investor_code,
      COALESCE(e.department, 'Unknown') as dept,
      -- Sum negative balances and convert to positive loan amount
      ABS(LEAST(SUM(COALESCE(br.ledger_balance, 0)), 0)) as loan_amount
    FROM balances_raw br
    LEFT JOIN investor_rm_assignments ira ON UPPER(ira.investor_code) = UPPER(br.investor_code)
    LEFT JOIN employees e ON LOWER(e.email) = LOWER(ira.rm_email)
    LEFT JOIN investors i ON UPPER(i.investor_code) = UPPER(br.investor_code)
    WHERE br.as_of_date = actual_from_date
      AND LOWER(COALESCE(i.account_type, '')) = 'margin'
    GROUP BY br.investor_code, COALESCE(e.department, 'Unknown')
    HAVING SUM(COALESCE(br.ledger_balance, 0)) < 0
  ),
  to_balances AS (
    -- Get margin loans (negative balances) per investor at end date
    SELECT 
      br.investor_code,
      COALESCE(e.department, 'Unknown') as dept,
      -- Sum negative balances and convert to positive loan amount
      ABS(LEAST(SUM(COALESCE(br.ledger_balance, 0)), 0)) as loan_amount
    FROM balances_raw br
    LEFT JOIN investor_rm_assignments ira ON UPPER(ira.investor_code) = UPPER(br.investor_code)
    LEFT JOIN employees e ON LOWER(e.email) = LOWER(ira.rm_email)
    LEFT JOIN investors i ON UPPER(i.investor_code) = UPPER(br.investor_code)
    WHERE br.as_of_date = actual_to_date
      AND LOWER(COALESCE(i.account_type, '')) = 'margin'
    GROUP BY br.investor_code, COALESCE(e.department, 'Unknown')
    HAVING SUM(COALESCE(br.ledger_balance, 0)) < 0
  ),
  from_dept AS (
    SELECT 
      dept as department,
      SUM(loan_amount) as total_loan,
      COUNT(DISTINCT investor_code) as clients
    FROM from_balances
    GROUP BY dept
  ),
  to_dept AS (
    SELECT 
      dept as department,
      SUM(loan_amount) as total_loan,
      COUNT(DISTINCT investor_code) as clients
    FROM to_balances
    GROUP BY dept
  )
  SELECT 
    COALESCE(fd.department, td.department) as department,
    COALESCE(fd.total_loan, 0) as beginning_loan,
    COALESCE(td.total_loan, 0) as ending_loan,
    COALESCE(td.total_loan, 0) - COALESCE(fd.total_loan, 0) as loan_change,
    CASE 
      WHEN COALESCE(fd.total_loan, 0) > 0 
      THEN ((COALESCE(td.total_loan, 0) - COALESCE(fd.total_loan, 0)) / fd.total_loan) * 100
      ELSE NULL 
    END as change_percent,
    COALESCE(td.clients, fd.clients, 0) as client_count
  FROM from_dept fd
  FULL OUTER JOIN to_dept td ON fd.department = td.department
  ORDER BY COALESCE(td.total_loan, 0) DESC;
END;
$function$;
