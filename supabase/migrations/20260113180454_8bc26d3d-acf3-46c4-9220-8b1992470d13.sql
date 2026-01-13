DROP FUNCTION IF EXISTS get_accounting_data(text,text,text,text,text,integer,integer);

CREATE FUNCTION get_accounting_data(
  _search text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _limit integer DEFAULT 1000,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  rm text,
  account_type text,
  department text,
  opening_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  deposits numeric,
  withdrawals numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END) AS buy_turnover,
      SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END) AS sell_turnover,
      SUM(COALESCE(th.brokerage_commission, 0)) AS brokerage
    FROM trade_history th
    WHERE (NULLIF(_from_trade_date, '') IS NULL OR th.trade_date >= NULLIF(_from_trade_date, ''))
      AND (NULLIF(_to_trade_date, '') IS NULL OR th.trade_date <= NULLIF(_to_trade_date, ''))
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE (NULLIF(_from_tx_date, '') IS NULL OR dw.transaction_date >= NULLIF(_from_tx_date, '')::date)
      AND (NULLIF(_to_tx_date, '') IS NULL OR dw.transaction_date <= NULLIF(_to_tx_date, '')::date)
    GROUP BY dw.investor_code
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_name,
      ira.department
    FROM investor_rm_assignments ira
    ORDER BY ira.investor_code, ira.percentage DESC
  )
  SELECT
    i.investor_code,
    i.investor_name,
    COALESCE(ra.rm_name, c.rm_name, '')::text AS rm,
    COALESCE(i.account_type, '')::text AS account_type,
    COALESCE(ra.department, '')::text AS department,
    COALESCE(c.ledger_balance, 0)::numeric AS opening_balance,
    COALESCE(ts.buy_turnover, 0)::numeric AS gross_buy,
    COALESCE(ts.sell_turnover, 0)::numeric AS gross_sell,
    COALESCE(tx.total_deposits, 0)::numeric AS deposits,
    COALESCE(tx.total_withdrawals, 0)::numeric AS withdrawals,
    (COALESCE(c.ledger_balance, 0) 
     + COALESCE(tx.total_deposits, 0) 
     - COALESCE(tx.total_withdrawals, 0)
     + COALESCE(ts.sell_turnover, 0) 
     - COALESCE(ts.buy_turnover, 0)
     - COALESCE(ts.brokerage, 0))::numeric AS closing_balance
  FROM investors i
  LEFT JOIN clients c ON i.investor_code = c.inv_code
  LEFT JOIN rm_assignments ra ON i.investor_code = ra.investor_code
  LEFT JOIN trade_sums ts ON i.investor_code = ts.client_code
  LEFT JOIN tx_sums tx ON i.investor_code = tx.investor_code
  WHERE (NULLIF(_search, '') IS NULL 
         OR i.investor_code ILIKE '%' || _search || '%'
         OR i.investor_name ILIKE '%' || _search || '%')
  ORDER BY i.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;