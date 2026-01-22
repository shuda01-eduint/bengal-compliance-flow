
-- Update get_accounting_data_v3 to prioritize investors table for RM metadata
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
SET search_path = public
AS $$
DECLARE
  _offset integer;
BEGIN
  SET LOCAL statement_timeout = '60s';
  _offset := (_page_number - 1) * _page_size;

  RETURN QUERY
  WITH base_clients AS (
    SELECT 
      c.investor_code,
      c.investor_name,
      COALESCE(c.acc_type, 'Cash') AS acc_type,
      c.brokerage_commission,
      c.interest_rate,
      c.ledger_balance,
      -- Priority: investors table (master) > investor_rm_assignments > clients (deprecated)
      COALESCE(c.rm_id, rm.rm_id, cli.rm_id) AS rm_id_val,
      COALESCE(c.rm_name, rm.rm_name, cli.rm_name, '') AS rm_val,
      COALESCE(c.department, rm.department, '') AS dept_val
    FROM investors c
    LEFT JOIN LATERAL (
      SELECT ira.rm_id, ira.rm_name, ira.department
      FROM investor_rm_assignments ira
      WHERE ira.investor_code = c.investor_code
      ORDER BY ira.percentage DESC
      LIMIT 1
    ) rm ON true
    LEFT JOIN clients cli ON cli.investor_code = c.investor_code
    WHERE (
      _account_type_filter IS NULL 
      OR _account_type_filter = 'all' 
      OR LOWER(COALESCE(c.acc_type, 'Cash')) = LOWER(_account_type_filter)
    )
  ),
  filtered_clients AS (
    SELECT bc.*
    FROM base_clients bc
    WHERE (
      _is_admin = true
      OR _is_dept_head = true
      OR _is_mancom = true
      OR (
        _user_email IS NOT NULL 
        AND EXISTS (
          SELECT 1 FROM employees e 
          WHERE LOWER(e.email) = LOWER(_user_email) 
          AND e.employee_id = bc.rm_id_val
        )
      )
    )
  ),
  opening_balances AS (
    SELECT 
      br.investor_code,
      br.ledger_balance AS opening_bal
    FROM balances_raw br
    INNER JOIN (
      SELECT investor_code, MAX(balance_date) as max_date
      FROM balances_raw
      WHERE balance_date < _start_date
      GROUP BY investor_code
    ) latest ON br.investor_code = latest.investor_code AND br.balance_date = latest.max_date
  ),
  trade_summary AS (
    SELECT 
      th.investor_code,
      SUM(CASE WHEN th.trade_type = 'B' THEN th.net_amount ELSE 0 END) AS buy_amt,
      SUM(CASE WHEN th.trade_type = 'S' THEN th.net_amount ELSE 0 END) AS sell_amt,
      SUM(th.commission) AS brokerage_amt
    FROM trade_history th
    WHERE th.trade_date BETWEEN _start_date AND _end_date
    GROUP BY th.investor_code
  ),
  deposit_withdraw AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.type = 'deposit' THEN dw.amount ELSE 0 END) AS dep_amt,
      SUM(CASE WHEN dw.type = 'withdrawal' THEN dw.amount ELSE 0 END) AS wd_amt
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date BETWEEN _start_date AND _end_date
    GROUP BY dw.investor_code
  ),
  interest_calc AS (
    SELECT 
      fc.investor_code,
      COALESCE(fc.interest_rate, 0) * 
        COALESCE(ob.opening_bal, fc.ledger_balance, 0) * 
        ((_end_date - _start_date + 1)::numeric / 365) / 100 AS interest_amt
    FROM filtered_clients fc
    LEFT JOIN opening_balances ob ON ob.investor_code = fc.investor_code
  ),
  combined AS (
    SELECT 
      fc.investor_code,
      fc.investor_name,
      COALESCE(ob.opening_bal, fc.ledger_balance, 0) AS opening_bal,
      COALESCE(dw.dep_amt, 0) AS dep_amt,
      COALESCE(dw.wd_amt, 0) AS wd_amt,
      COALESCE(ts.buy_amt, 0) AS buy_amt,
      COALESCE(ts.sell_amt, 0) AS sell_amt,
      COALESCE(ts.brokerage_amt, 0) AS brokerage_amt,
      COALESCE(ic.interest_amt, 0) AS interest_amt,
      fc.acc_type,
      fc.rm_id_val,
      fc.rm_val,
      fc.dept_val
    FROM filtered_clients fc
    LEFT JOIN opening_balances ob ON ob.investor_code = fc.investor_code
    LEFT JOIN trade_summary ts ON ts.investor_code = fc.investor_code
    LEFT JOIN deposit_withdraw dw ON dw.investor_code = fc.investor_code
    LEFT JOIN interest_calc ic ON ic.investor_code = fc.investor_code
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM combined
  )
  SELECT 
    cm.investor_code,
    cm.investor_name,
    cm.opening_bal,
    cm.dep_amt,
    cm.wd_amt,
    cm.buy_amt,
    cm.sell_amt,
    cm.brokerage_amt,
    cm.interest_amt,
    (cm.opening_bal + cm.dep_amt - cm.wd_amt + cm.sell_amt - cm.buy_amt - cm.brokerage_amt) AS closing_bal,
    cm.acc_type,
    cm.rm_id_val,
    cm.rm_val,
    cm.dept_val,
    t.cnt
  FROM combined cm
  CROSS JOIN total t
  ORDER BY cm.investor_code
  LIMIT _page_size
  OFFSET _offset;
END;
$$;
