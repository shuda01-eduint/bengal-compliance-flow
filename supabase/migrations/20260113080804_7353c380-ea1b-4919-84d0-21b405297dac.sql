-- Drop ALL existing overloads of get_accounting_data to ensure clean slate
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text);

-- Create optimized set-based get_accounting_data function (CTE approach - no LATERAL)
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  department text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  closing_balance numeric
)
LANGUAGE plpgsql STABLE
SET statement_timeout = '60s'
AS $$
BEGIN
  RETURN QUERY
  WITH trade_agg AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, 0) ELSE 0 END) as total_sell
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  active_codes AS (
    SELECT client_code as code FROM trade_agg WHERE total_buy > 0 OR total_sell > 0
    UNION
    SELECT investor_code as code FROM tx_agg WHERE total_deposits > 0 OR total_withdrawals > 0
  )
  SELECT 
    c.inv_code,
    c.investor_name,
    c.rm_name,
    COALESCE(c.ledger_balance, 0),
    COALESCE(tx.total_deposits, 0),
    COALESCE(tx.total_withdrawals, 0),
    COALESCE(ta.total_buy, 0),
    COALESCE(ta.total_sell, 0),
    COALESCE(c.ledger_balance, 0) 
      + COALESCE(tx.total_deposits, 0) 
      - COALESCE(tx.total_withdrawals, 0) 
      - COALESCE(ta.total_buy, 0) 
      + COALESCE(ta.total_sell, 0)
  FROM clients c
  INNER JOIN active_codes ac ON c.inv_code = ac.code
  LEFT JOIN trade_agg ta ON c.inv_code = ta.client_code
  LEFT JOIN tx_agg tx ON c.inv_code = tx.investor_code
  WHERE (_search IS NULL OR _search = '' 
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%')
  ORDER BY c.inv_code;
END;
$$;