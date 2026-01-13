-- Drop existing function
DROP FUNCTION IF EXISTS get_accounting_data(text,text,text,text,text,integer,integer);

-- Recreate with fixed commission calculation (value * rate instead of just rate)
CREATE OR REPLACE FUNCTION get_accounting_data(
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit integer DEFAULT 500,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
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
AS $$
BEGIN
  RETURN QUERY
  WITH client_base AS (
    SELECT DISTINCT c.inv_code
    FROM clients c
    WHERE (_search IS NULL OR _search = '' 
           OR c.inv_code ILIKE '%' || _search || '%'
           OR c.investor_name ILIKE '%' || _search || '%'
           OR c.rm_name ILIKE '%' || _search || '%')
    LIMIT _limit OFFSET _offset
  ),
  trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END) AS buy_turnover,
      SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END) AS sell_turnover,
      -- FIX: Calculate actual commission as value * rate
      SUM(COALESCE(th.value * th.brokerage_commission, 0)) AS brokerage
    FROM trade_history th
    INNER JOIN client_base cb ON th.client_code = cb.inv_code
    WHERE (
      (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date::date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date::date)
    )
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    INNER JOIN client_base cb ON dw.investor_code = cb.inv_code
    WHERE (
      (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    )
    GROUP BY dw.investor_code
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_name,
      ira.rm_email,
      ira.department
    FROM investor_rm_assignments ira
    INNER JOIN client_base cb ON ira.investor_code = cb.inv_code
    ORDER BY ira.investor_code, ira.percentage DESC, ira.created_at DESC
  )
  SELECT
    c.inv_code AS investor_code,
    c.investor_name,
    COALESCE(ra.rm_name, c.rm_name) AS rm,
    COALESCE(ra.department, 'Unassigned') AS department,
    COALESCE(i.account_type, 'Cash') AS account_type,
    COALESCE(c.ledger_balance, 0) AS opening_balance,
    COALESCE(ds.total_deposits, 0) AS deposits,
    COALESCE(ds.total_withdrawals, 0) AS withdrawals,
    COALESCE(ts.buy_turnover, 0) + COALESCE(ts.brokerage, 0) AS gross_buy,
    COALESCE(ts.sell_turnover, 0) AS gross_sell,
    COALESCE(c.ledger_balance, 0) 
      + COALESCE(ds.total_deposits, 0) 
      - COALESCE(ds.total_withdrawals, 0) 
      + COALESCE(ts.sell_turnover, 0) 
      - COALESCE(ts.buy_turnover, 0) 
      - COALESCE(ts.brokerage, 0) AS closing_balance
  FROM clients c
  INNER JOIN client_base cb ON c.inv_code = cb.inv_code
  LEFT JOIN trade_sums ts ON c.inv_code = ts.client_code
  LEFT JOIN deposit_sums ds ON c.inv_code = ds.investor_code
  LEFT JOIN rm_assignments ra ON c.inv_code = ra.investor_code
  LEFT JOIN investors i ON c.inv_code = i.investor_code;
END;
$$;