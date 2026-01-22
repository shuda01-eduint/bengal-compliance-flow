-- Drop and recreate get_accounting_data_v3 with correct logic
-- Fix: Remove invalid is_primary reference, join employees for department

DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, boolean, text, boolean, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _start_date date,
  _end_date date,
  _account_type_filter text DEFAULT NULL,
  _is_admin boolean DEFAULT false,
  _user_email text DEFAULT NULL,
  _is_dept_head boolean DEFAULT false,
  _is_mancom boolean DEFAULT false,
  _page_number integer DEFAULT 1,
  _page_size integer DEFAULT 500
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  buy_amount numeric,
  sell_amount numeric,
  brokerage numeric,
  accrued_interest numeric,
  closing_balance numeric,
  acc_type text,
  rm_id text,
  rm_name text,
  department text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _offset integer;
  _start_date_str text;
  _end_date_str text;
BEGIN
  SET LOCAL statement_timeout = '120s';
  _offset := (_page_number - 1) * _page_size;
  
  -- Convert dates to string format for trade_history comparison
  _start_date_str := to_char(_start_date, 'YYYYMMDD');
  _end_date_str := to_char(_end_date, 'YYYYMMDD');

  RETURN QUERY
  WITH base_investors AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(i.acc_type, 'Cash') AS acc_type,
      i.brokerage_commission,
      i.interest_rate,
      i.ledger_balance,
      i.rm_id AS master_rm_id,
      i.rm_name AS master_rm_name,
      i.department AS master_department
    FROM investors i
    WHERE (
      _account_type_filter IS NULL 
      OR LOWER(COALESCE(i.acc_type, 'Cash')) = LOWER(_account_type_filter)
    )
  ),
  -- Get highest percentage RM assignment for each investor
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_email,
      ira.rm_name
    FROM investor_rm_assignments ira
    ORDER BY ira.investor_code, ira.percentage DESC NULLS LAST, ira.created_at DESC
  ),
  -- Match RM to employees for department lookup
  rm_with_dept AS (
    SELECT 
      ra.investor_code,
      ra.rm_name,
      e.department,
      e.employee_id
    FROM rm_assignments ra
    LEFT JOIN employees e ON (
      LOWER(e.email) = LOWER(ra.rm_email)
      OR LOWER(CONCAT(e.employee_id, '@ucbstock.com.bd')) = LOWER(ra.rm_email)
    )
  ),
  -- Get opening balances from the day before start date
  opening_bal AS (
    SELECT 
      br.investor_code,
      SUM(COALESCE(br.ledger_balance, 0)) as opening_balance
    FROM balances_raw br
    WHERE br.as_of_date = _start_date - INTERVAL '1 day'
    GROUP BY br.investor_code
  ),
  -- Aggregate trades in date range
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as buy_amount,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as sell_amount,
      COALESCE(SUM(th.brokerage_commission), 0) as brokerage
    FROM trade_history th
    WHERE th.trade_date >= _start_date_str
      AND th.trade_date <= _end_date_str
      AND (
        UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL')
        OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL')
      )
    GROUP BY th.client_code
  ),
  -- Aggregate deposits/withdrawals in date range
  dw_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date >= _start_date
      AND dw.transaction_date <= _end_date
    GROUP BY dw.investor_code
  ),
  -- Combined data with role-based filtering
  combined AS (
    SELECT 
      bi.investor_code,
      bi.investor_name,
      bi.acc_type,
      COALESCE(bi.master_rm_id, rwd.employee_id, '') as rm_id,
      COALESCE(bi.master_rm_name, rwd.rm_name, '') as rm_name,
      COALESCE(rwd.department, bi.master_department, '') as department,
      COALESCE(ob.opening_balance, bi.ledger_balance, 0) as opening_balance,
      COALESCE(dw.deposits, 0) as deposits,
      COALESCE(dw.withdrawals, 0) as withdrawals,
      COALESCE(ta.buy_amount, 0) as buy_amount,
      COALESCE(ta.sell_amount, 0) as sell_amount,
      COALESCE(ta.brokerage, 0) as brokerage,
      0::numeric as accrued_interest
    FROM base_investors bi
    LEFT JOIN rm_with_dept rwd ON rwd.investor_code = bi.investor_code
    LEFT JOIN opening_bal ob ON ob.investor_code = bi.investor_code
    LEFT JOIN trade_agg ta ON ta.investor_code = bi.investor_code
    LEFT JOIN dw_agg dw ON dw.investor_code = bi.investor_code
    WHERE (
      _is_admin = true
      OR (
        _is_dept_head = true 
        AND COALESCE(rwd.department, bi.master_department, '') IN (
          SELECT d.name 
          FROM departments d 
          JOIN profiles p ON p.department_id = d.id 
          WHERE LOWER(p.email) = LOWER(_user_email) 
            AND p.is_department_head = true
        )
      )
      OR (
        _is_mancom = true
        AND COALESCE(rwd.department, bi.master_department, '') IN (
          SELECT COALESCE(e.department, '')
          FROM outlet_managers om
          JOIN employees e ON LOWER(e.email) = LOWER(om.manager_email)
          WHERE LOWER(om.mancom_email) = LOWER(_user_email)
        )
      )
      OR (
        _user_email IS NOT NULL 
        AND _is_admin = false 
        AND _is_dept_head = false 
        AND _is_mancom = false
        AND EXISTS (
          SELECT 1 FROM investor_rm_assignments ira2
          WHERE ira2.investor_code = bi.investor_code
            AND LOWER(ira2.rm_email) = LOWER(_user_email)
        )
      )
    )
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM combined
  )
  SELECT 
    c.investor_code,
    c.investor_name,
    c.opening_balance,
    c.deposits,
    c.withdrawals,
    c.buy_amount,
    c.sell_amount,
    c.brokerage,
    c.accrued_interest,
    (c.opening_balance + c.deposits - c.withdrawals + c.sell_amount - c.buy_amount - c.brokerage) as closing_balance,
    c.acc_type,
    c.rm_id,
    c.rm_name,
    c.department,
    cnt.cnt as total_count
  FROM combined c, counted cnt
  ORDER BY c.investor_code
  LIMIT _page_size
  OFFSET _offset;
END;
$function$;