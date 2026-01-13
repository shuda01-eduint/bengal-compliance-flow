-- Drop existing function overloads first
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text);
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,integer,integer);

-- Recreate function with activity filter
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
  _search TEXT DEFAULT NULL,
  _limit INTEGER DEFAULT 1000,
  _offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  rm_name TEXT,
  department TEXT,
  account_type TEXT,
  opening_balance NUMERIC,
  deposits NUMERIC,
  withdrawals NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  closing_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH trade_sums AS (
    SELECT
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    GROUP BY dw.investor_code
  )
  SELECT
    c.inv_code AS investor_code,
    c.investor_name,
    c.rm_name,
    COALESCE(
      (SELECT e.department FROM employees e WHERE LOWER(e.email) = LOWER(c.rm_email) LIMIT 1),
      'Unknown'
    ) AS department,
    COALESCE(
      (SELECT i.account_type FROM investors i WHERE i.investor_code = c.inv_code LIMIT 1),
      'Unknown'
    ) AS account_type,
    c.ledger_balance AS opening_balance,
    COALESCE(tx.deposits, 0) AS deposits,
    COALESCE(tx.withdrawals, 0) AS withdrawals,
    COALESCE(ts.buy_sum, 0) AS gross_buy,
    COALESCE(ts.sell_sum, 0) AS gross_sell,
    (c.ledger_balance + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) - COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) AS closing_balance
  FROM clients c
  LEFT JOIN trade_sums ts ON ts.client_code = c.inv_code
  LEFT JOIN tx_sums tx ON tx.investor_code = c.inv_code
  WHERE (
    -- Only include investors with activity (trades OR deposits/withdrawals)
    ts.client_code IS NOT NULL OR tx.investor_code IS NOT NULL
  )
  AND (
    _search IS NULL
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%'
    OR c.rm_name ILIKE '%' || _search || '%'
  )
  ORDER BY c.inv_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;