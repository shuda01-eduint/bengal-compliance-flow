-- Drop existing function
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, text, text);

-- Recreate with CORRECT column names
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search text DEFAULT NULL,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL
)
RETURNS TABLE(
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH trade_activity AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN th.value ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.side = 'SELL' THEN th.value ELSE 0 END) as total_sell
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_activity AS (
    SELECT 
      dw.investor_code as client_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) as total_withdrawals
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
    c.inv_code as investor_code,
    c.investor_name as investor_name,
    c.rm_name as department,
    COALESCE(c.ledger_balance, 0) as opening_balance,
    COALESCE(tx.total_deposits, 0) as deposits,
    COALESCE(tx.total_withdrawals, 0) as withdrawals,
    COALESCE(ta.total_buy, 0) as gross_buy,
    COALESCE(ta.total_sell, 0) as gross_sell,
    COALESCE(c.ledger_balance, 0) 
      + COALESCE(tx.total_deposits, 0) 
      - COALESCE(tx.total_withdrawals, 0) 
      - COALESCE(ta.total_buy, 0) 
      + COALESCE(ta.total_sell, 0) as closing_balance
  FROM clients c
  INNER JOIN active_codes ac ON c.inv_code = ac.client_code
  LEFT JOIN trade_activity ta ON c.inv_code = ta.client_code
  LEFT JOIN tx_activity tx ON c.inv_code = tx.client_code
  WHERE (_search IS NULL OR _search = '' 
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%')
  ORDER BY 
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.investor_name
        WHEN 'department' THEN c.rm_name
        ELSE c.inv_code
      END
    END ASC,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.investor_name
        WHEN 'department' THEN c.rm_name
        ELSE c.inv_code
      END
    END DESC;
END;
$$;