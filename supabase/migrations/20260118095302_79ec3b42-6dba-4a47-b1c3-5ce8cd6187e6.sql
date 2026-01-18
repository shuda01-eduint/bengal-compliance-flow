
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date text,
  _tx_date text,
  _search text DEFAULT ''::text,
  _account_type_filter text DEFAULT 'all'::text,
  _has_activity_filter text DEFAULT 'all'::text,
  _limit integer DEFAULT 1000,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  rm text,
  department text,
  account_type text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _opening_date_str text := replace(_opening_date, '-', '');
  _trade_date_str text := replace(_tx_date, '-', '');
BEGIN
  RETURN QUERY
  WITH opening_balances AS (
    SELECT 
      br.investor_code,
      br.rm_name,
      br.rm_email,
      COALESCE(br.ledger_balance, 0) as opening_bal
    FROM balances_raw br
    WHERE br.as_of_date = _opening_date
  ),
  trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN th.side = 'B' OR th.side = 'Buy' THEN COALESCE(th.value, 0) ELSE 0 END) as buy_sum,
      SUM(CASE WHEN th.side = 'S' OR th.side = 'Sell' THEN COALESCE(th.value, 0) ELSE 0 END) as sell_sum
    FROM trade_history th
    WHERE th.trade_date = _trade_date_str
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as dep_sum,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as wd_sum
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = _tx_date
    GROUP BY dw.investor_code
  ),
  combined AS (
    SELECT
      COALESCE(ob.investor_code, ts.client_code, ds.investor_code) as inv_code,
      ob.rm_name,
      ob.rm_email,
      COALESCE(ob.opening_bal, 0) as opening_bal,
      COALESCE(ds.dep_sum, 0) as deposits,
      COALESCE(ds.wd_sum, 0) as withdrawals,
      COALESCE(ts.buy_sum, 0) as gross_buy,
      COALESCE(ts.sell_sum, 0) as gross_sell
    FROM opening_balances ob
    FULL OUTER JOIN trade_sums ts ON ob.investor_code = ts.client_code
    FULL OUTER JOIN deposit_sums ds ON COALESCE(ob.investor_code, ts.client_code) = ds.investor_code
  )
  SELECT
    c.inv_code::text as investor_code,
    COALESCE(i.investor_name, '')::text as investor_name,
    COALESCE(c.rm_name, '')::text as rm,
    COALESCE(e.department, '')::text as department,
    COALESCE(i.account_type, '')::text as account_type,
    c.opening_bal as opening_balance,
    c.deposits,
    c.withdrawals,
    c.gross_buy,
    c.gross_sell,
    (c.opening_bal + c.deposits - c.withdrawals - c.gross_buy + c.gross_sell) as closing_balance
  FROM combined c
  LEFT JOIN investors i ON c.inv_code = i.investor_code
  LEFT JOIN employees e ON c.rm_email = e.email
  WHERE 
    (_search = '' OR c.inv_code ILIKE '%' || _search || '%' OR COALESCE(i.investor_name, '') ILIKE '%' || _search || '%')
    AND (_account_type_filter = 'all' OR COALESCE(i.account_type, '') = _account_type_filter)
    AND (
      _has_activity_filter = 'all'
      OR (_has_activity_filter = 'with_trades' AND (c.gross_buy > 0 OR c.gross_sell > 0))
      OR (_has_activity_filter = 'no_trades' AND c.gross_buy = 0 AND c.gross_sell = 0)
    )
  ORDER BY c.inv_code
  LIMIT _limit
  OFFSET _offset;
END;
$function$;
