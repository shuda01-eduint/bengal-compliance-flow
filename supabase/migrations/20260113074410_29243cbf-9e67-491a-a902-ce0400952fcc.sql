-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,text,text);

-- Recreate optimized get_accounting_data function with fixed ORDER BY
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc'
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
  WITH trade_activity AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, 0) ELSE 0 END) as total_sell
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_activity AS (
    SELECT 
      dw.investor_code as client_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date::date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date::date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  active_codes AS (
    SELECT client_code FROM trade_activity
    UNION
    SELECT client_code FROM tx_activity
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
  INNER JOIN active_codes ac ON c.inv_code = ac.client_code
  LEFT JOIN trade_activity ta ON c.inv_code = ta.client_code
  LEFT JOIN tx_activity tx ON c.inv_code = tx.client_code
  WHERE (_search IS NULL OR _search = '' 
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%')
  ORDER BY c.inv_code;  -- Fixed ordering for performance - sorting done client-side
END;
$$;

-- Add index for faster date-based lookups on trade_history
CREATE INDEX IF NOT EXISTS idx_trade_history_trade_date_client 
ON trade_history(trade_date, client_code);

-- Add index for faster date-based lookups on deposits_withdrawals  
CREATE INDEX IF NOT EXISTS idx_deposits_withdrawals_date_investor 
ON deposits_withdrawals(transaction_date, investor_code);