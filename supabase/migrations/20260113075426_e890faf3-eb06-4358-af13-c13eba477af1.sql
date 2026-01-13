-- Update table statistics for better query planning
ANALYZE trade_history;
ANALYZE deposits_withdrawals;
ANALYZE clients;

-- Drop the existing function
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,text,text);

-- Recreate optimized get_accounting_data function with LEFT JOIN LATERAL
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
AS $$
BEGIN
  RETURN QUERY
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
  LEFT JOIN LATERAL (
    SELECT 
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, 0) ELSE 0 END) as total_sell
    FROM trade_history th
    WHERE th.client_code = c.inv_code
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  ) ta ON true
  LEFT JOIN LATERAL (
    SELECT 
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.investor_code = c.inv_code
      AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
  ) tx ON true
  WHERE (
    -- Only return rows with activity OR matching search
    (COALESCE(ta.total_buy, 0) > 0 OR COALESCE(ta.total_sell, 0) > 0 OR COALESCE(tx.total_deposits, 0) > 0 OR COALESCE(tx.total_withdrawals, 0) > 0)
    OR (_search IS NOT NULL AND _search != '' AND (
      c.inv_code ILIKE '%' || _search || '%' OR
      c.investor_name ILIKE '%' || _search || '%'
    ))
  )
  AND (_search IS NULL OR _search = '' 
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%')
  ORDER BY c.inv_code;
END;
$$;