
-- First drop the existing function, then recreate with correct RM/Dept prioritization
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, text, text, integer, integer);

CREATE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT ''::text,
  _account_type_filter text DEFAULT 'all'::text,
  _has_activity_filter text DEFAULT 'all'::text,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  rm text,
  department text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  brokerage_amount numeric,
  accrued_interest numeric,
  closing_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SET statement_timeout = '60s'
AS $function$
DECLARE
  search_pattern text;
BEGIN
  search_pattern := '%' || LOWER(COALESCE(_search, '')) || '%';
  
  RETURN QUERY
  WITH base_investors AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      -- Priority: investors master -> investor_rm_assignments -> clients (legacy)
      COALESCE(i.rm_name, rm.rm_name, cli.rm_name, '') AS rm_val,
      COALESCE(i.department, rm.department, '') AS dept_val,
      COALESCE(i.account_type, cli.account_type, 'Cash') AS acc_type,
      COALESCE(i.interest_rate, cli.interest_rate, 0) AS int_rate,
      COALESCE(i.brokerage_commission, cli.brokerage_commission, 0.25) AS brok_rate
    FROM investors i
    LEFT JOIN investor_rm_assignments rm ON rm.investor_code = i.investor_code AND rm.is_primary = true
    LEFT JOIN clients cli ON cli.client_code = i.investor_code
    WHERE 
      (_search = '' OR _search IS NULL OR 
       LOWER(i.investor_code) LIKE search_pattern OR 
       LOWER(COALESCE(i.investor_name, '')) LIKE search_pattern)
      AND (
        _account_type_filter = 'all' OR _account_type_filter IS NULL OR _account_type_filter = ''
        OR LOWER(COALESCE(i.account_type, cli.account_type, 'Cash')) = LOWER(_account_type_filter)
      )
  ),
  opening_balances AS (
    SELECT 
      b.investor_code,
      COALESCE(b.ledger_balance, 0) AS opening_bal
    FROM balances_raw b
    WHERE b.as_of_date = _opening_date
  ),
  deposits_sum AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = _tx_date
    GROUP BY dw.investor_code
  ),
  trades_sum AS (
    SELECT 
      t.client_code AS investor_code,
      SUM(CASE WHEN UPPER(t.side) = 'BUY' THEN COALESCE(t.value, 0) ELSE 0 END) AS total_buy,
      SUM(CASE WHEN UPPER(t.side) = 'SELL' THEN COALESCE(t.value, 0) ELSE 0 END) AS total_sell,
      SUM(COALESCE(t.commission, 0)) AS total_commission
    FROM trade_history t
    WHERE t.trade_date = _tx_date
    GROUP BY t.client_code
  ),
  combined AS (
    SELECT 
      bi.investor_code,
      bi.investor_name,
      bi.rm_val,
      bi.dept_val,
      bi.acc_type,
      bi.int_rate,
      bi.brok_rate,
      COALESCE(ob.opening_bal, 0) AS opening_bal,
      COALESCE(ds.total_deposits, 0) AS deps,
      COALESCE(ds.total_withdrawals, 0) AS wds,
      COALESCE(ts.total_buy, 0) AS buys,
      COALESCE(ts.total_sell, 0) AS sells,
      COALESCE(ts.total_commission, 0) AS comm,
      -- Has activity check
      (COALESCE(ds.total_deposits, 0) > 0 OR 
       COALESCE(ds.total_withdrawals, 0) > 0 OR 
       COALESCE(ts.total_buy, 0) > 0 OR 
       COALESCE(ts.total_sell, 0) > 0) AS has_activity
    FROM base_investors bi
    LEFT JOIN opening_balances ob ON ob.investor_code = bi.investor_code
    LEFT JOIN deposits_sum ds ON ds.investor_code = bi.investor_code
    LEFT JOIN trades_sum ts ON ts.investor_code = bi.investor_code
  ),
  filtered AS (
    SELECT *
    FROM combined c
    WHERE 
      _has_activity_filter = 'all' OR _has_activity_filter IS NULL OR _has_activity_filter = ''
      OR (_has_activity_filter = 'yes' AND c.has_activity = true)
      OR (_has_activity_filter = 'no' AND c.has_activity = false)
  ),
  counted AS (
    SELECT COUNT(*) AS cnt FROM filtered
  )
  SELECT 
    f.investor_code::text,
    COALESCE(f.investor_name, '')::text,
    f.rm_val::text,
    f.dept_val::text,
    f.acc_type::text,
    f.int_rate::numeric,
    f.brok_rate::numeric,
    f.opening_bal::numeric,
    f.deps::numeric,
    f.wds::numeric,
    f.buys::numeric,
    f.sells::numeric,
    f.comm::numeric,
    (f.opening_bal * f.int_rate / 100 / 365)::numeric AS accrued_int,
    (f.opening_bal + f.deps - f.wds + f.sells - f.buys - f.comm)::numeric AS closing_bal,
    (SELECT cnt FROM counted)::bigint
  FROM filtered f
  ORDER BY f.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$function$;
