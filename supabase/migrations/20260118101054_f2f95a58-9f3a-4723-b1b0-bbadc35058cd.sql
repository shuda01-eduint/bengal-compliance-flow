-- Drop ALL versions of get_accounting_data_v3 with different signatures
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(text, text, text, text, text, integer, integer);

-- Recreate with explicit type casting inside
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date text,
  _tx_date text,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT 'all',
  _has_activity_filter text DEFAULT 'all',
  _limit integer DEFAULT 1000,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm text,
  department text,
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
AS $$
DECLARE
  v_opening_date date;
  v_tx_date date;
BEGIN
  -- Cast text parameters to date
  v_opening_date := REPLACE(_opening_date, '-', '-')::date;
  v_tx_date := REPLACE(_tx_date, '-', '-')::date;

  RETURN QUERY
  WITH opening_balances AS (
    SELECT 
      br.investor_code,
      COALESCE(br.ledger_balance, 0) AS opening_balance
    FROM balances_raw br
    WHERE br.as_of_date = v_opening_date::text
  ),
  trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN th.side = 'BUY' OR th.side = 'B' THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'SELL' OR th.side = 'S' THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE th.trade_date = v_tx_date::text
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = v_tx_date::text
    GROUP BY dw.investor_code
  ),
  combined AS (
    SELECT DISTINCT COALESCE(i.investor_code, ob.investor_code, ts.client_code, ds.investor_code) AS inv_code
    FROM investors i
    FULL OUTER JOIN opening_balances ob ON i.investor_code = ob.investor_code
    FULL OUTER JOIN trade_sums ts ON i.investor_code = ts.client_code
    FULL OUTER JOIN deposit_sums ds ON i.investor_code = ds.investor_code
    WHERE COALESCE(i.investor_code, ob.investor_code, ts.client_code, ds.investor_code) IS NOT NULL
  ),
  base_data AS (
    SELECT 
      c.inv_code,
      COALESCE(i.investor_name, 'Unknown') AS investor_name,
      COALESCE(i.account_type, 'Cash') AS account_type,
      COALESCE(ira.rm_name, '') AS rm,
      COALESCE(ira.department, '') AS department,
      COALESCE(ob.opening_balance, 0) AS opening_balance,
      COALESCE(ds.total_deposits, 0) AS deposits,
      COALESCE(ds.total_withdrawals, 0) AS withdrawals,
      COALESCE(ts.buy_sum, 0) AS gross_buy,
      COALESCE(ts.sell_sum, 0) AS gross_sell,
      (COALESCE(ob.opening_balance, 0) + COALESCE(ds.total_deposits, 0) - COALESCE(ds.total_withdrawals, 0) - COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) AS closing_balance,
      (COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) > 0 AS has_trades
    FROM combined c
    LEFT JOIN investors i ON c.inv_code = i.investor_code
    LEFT JOIN opening_balances ob ON c.inv_code = ob.investor_code
    LEFT JOIN trade_sums ts ON c.inv_code = ts.client_code
    LEFT JOIN deposit_sums ds ON c.inv_code = ds.investor_code
    LEFT JOIN LATERAL (
      SELECT ira2.rm_name, ira2.department
      FROM investor_rm_assignments ira2
      WHERE ira2.investor_code = c.inv_code
      ORDER BY ira2.percentage DESC
      LIMIT 1
    ) ira ON true
  )
  SELECT 
    bd.inv_code::text,
    bd.investor_name::text,
    bd.account_type::text,
    bd.rm::text,
    bd.department::text,
    bd.opening_balance,
    bd.deposits,
    bd.withdrawals,
    bd.gross_buy,
    bd.gross_sell,
    bd.closing_balance
  FROM base_data bd
  WHERE 
    (_search = '' OR bd.inv_code ILIKE '%' || _search || '%' OR bd.investor_name ILIKE '%' || _search || '%')
    AND (_account_type_filter = 'all' OR bd.account_type = _account_type_filter)
    AND (_has_activity_filter = 'all' OR (_has_activity_filter = 'with_trades' AND bd.has_trades))
  ORDER BY bd.inv_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;