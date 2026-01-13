
-- Drop and recreate the get_accounting_data function with new columns
DROP FUNCTION IF EXISTS public.get_accounting_data;

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _search text DEFAULT NULL
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
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
  v_from_trade date;
  v_to_trade date;
  v_from_tx date;
  v_to_tx date;
BEGIN
  -- Parse dates
  v_from_trade := CASE WHEN _from_trade_date IS NOT NULL AND _from_trade_date != '' 
                       THEN _from_trade_date::date ELSE NULL END;
  v_to_trade := CASE WHEN _to_trade_date IS NOT NULL AND _to_trade_date != '' 
                     THEN _to_trade_date::date ELSE NULL END;
  v_from_tx := CASE WHEN _from_tx_date IS NOT NULL AND _from_tx_date != '' 
                    THEN _from_tx_date::date ELSE NULL END;
  v_to_tx := CASE WHEN _to_tx_date IS NOT NULL AND _to_tx_date != '' 
                  THEN _to_tx_date::date ELSE NULL END;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN th.side = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE (v_from_trade IS NULL OR th.trade_date::date >= v_from_trade)
      AND (v_to_trade IS NULL OR th.trade_date::date <= v_to_trade)
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT 
      dw.investor_code AS inv_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS deposit_sum,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawal_sum
    FROM deposits_withdrawals dw
    WHERE (v_from_tx IS NULL OR dw.transaction_date::date >= v_from_tx)
      AND (v_to_tx IS NULL OR dw.transaction_date::date <= v_to_tx)
    GROUP BY dw.investor_code
  )
  SELECT 
    c.inv_code::text AS investor_code,
    c.investor_name::text AS investor_name,
    COALESCE(i.account_type, '')::text AS account_type,
    COALESCE(c.rm_name, '')::text AS rm_name,
    COALESCE(ira.department, '')::text AS department,
    c.ledger_balance AS opening_balance,
    COALESCE(tx.deposit_sum, 0) AS deposits,
    COALESCE(tx.withdrawal_sum, 0) AS withdrawals,
    COALESCE(ts.buy_sum, 0) AS gross_buy,
    COALESCE(ts.sell_sum, 0) AS gross_sell,
    (c.ledger_balance + COALESCE(tx.deposit_sum, 0) - COALESCE(tx.withdrawal_sum, 0) 
     - COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) AS closing_balance
  FROM clients c
  LEFT JOIN investors i ON c.inv_code = i.investor_code
  LEFT JOIN investor_rm_assignments ira ON c.inv_code = ira.investor_code
  LEFT JOIN trade_sums ts ON c.inv_code = ts.client_code
  LEFT JOIN tx_sums tx ON c.inv_code = tx.inv_code
  WHERE (_search IS NULL OR _search = '' 
         OR c.inv_code ILIKE '%' || _search || '%' 
         OR c.investor_name ILIKE '%' || _search || '%'
         OR c.rm_name ILIKE '%' || _search || '%'
         OR i.account_type ILIKE '%' || _search || '%'
         OR ira.department ILIKE '%' || _search || '%')
  ORDER BY c.inv_code;
END;
$$;
