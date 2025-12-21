
-- Drop and recreate the function to include actual dates used
DROP FUNCTION IF EXISTS get_margin_composition_by_department(date, date);

CREATE OR REPLACE FUNCTION get_margin_composition_by_department(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  department text,
  beginning_loan numeric,
  ending_loan numeric,
  loan_change numeric,
  change_percent numeric,
  client_count bigint,
  actual_from_date date,
  actual_to_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_date date;
  v_to_date date;
  v_actual_from_date date;
  v_actual_to_date date;
BEGIN
  -- Default dates
  v_from_date := COALESCE(p_from_date, CURRENT_DATE - INTERVAL '7 days');
  v_to_date := COALESCE(p_to_date, CURRENT_DATE);
  
  -- Find the closest available date for the from_date (on or before)
  SELECT MAX(as_of_date) INTO v_actual_from_date
  FROM balances_raw
  WHERE as_of_date <= v_from_date;
  
  -- If no date found on or before, get the earliest available date
  IF v_actual_from_date IS NULL THEN
    SELECT MIN(as_of_date) INTO v_actual_from_date FROM balances_raw;
  END IF;
  
  -- Find the closest available date for the to_date (on or before)
  SELECT MAX(as_of_date) INTO v_actual_to_date
  FROM balances_raw
  WHERE as_of_date <= v_to_date;
  
  -- If no date found on or before, get the latest available date
  IF v_actual_to_date IS NULL THEN
    SELECT MAX(as_of_date) INTO v_actual_to_date FROM balances_raw;
  END IF;
  
  RETURN QUERY
  WITH beginning_balances AS (
    SELECT 
      COALESCE(ira.department, 'Unassigned') AS dept,
      SUM(CASE WHEN br.ledger_balance < 0 THEN ABS(br.ledger_balance) ELSE 0 END) AS total_loan
    FROM balances_raw br
    LEFT JOIN investor_rm_assignments ira ON br.investor_code = ira.investor_code
    WHERE br.as_of_date = v_actual_from_date
    GROUP BY COALESCE(ira.department, 'Unassigned')
  ),
  ending_balances AS (
    SELECT 
      COALESCE(ira.department, 'Unassigned') AS dept,
      SUM(CASE WHEN br.ledger_balance < 0 THEN ABS(br.ledger_balance) ELSE 0 END) AS total_loan,
      COUNT(DISTINCT CASE WHEN br.ledger_balance < 0 THEN br.investor_code END) AS client_cnt
    FROM balances_raw br
    LEFT JOIN investor_rm_assignments ira ON br.investor_code = ira.investor_code
    WHERE br.as_of_date = v_actual_to_date
    GROUP BY COALESCE(ira.department, 'Unassigned')
  )
  SELECT 
    COALESCE(eb.dept, bb.dept) AS department,
    COALESCE(bb.total_loan, 0) AS beginning_loan,
    COALESCE(eb.total_loan, 0) AS ending_loan,
    COALESCE(eb.total_loan, 0) - COALESCE(bb.total_loan, 0) AS loan_change,
    CASE 
      WHEN COALESCE(bb.total_loan, 0) > 0 
      THEN ROUND(((COALESCE(eb.total_loan, 0) - COALESCE(bb.total_loan, 0)) / bb.total_loan) * 100, 2)
      ELSE 0
    END AS change_percent,
    COALESCE(eb.client_cnt, 0) AS client_count,
    v_actual_from_date AS actual_from_date,
    v_actual_to_date AS actual_to_date
  FROM ending_balances eb
  FULL OUTER JOIN beginning_balances bb ON eb.dept = bb.dept
  ORDER BY COALESCE(eb.total_loan, 0) DESC;
END;
$$;
