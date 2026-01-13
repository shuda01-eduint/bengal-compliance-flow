-- Add pagination support to get_accounting_data function
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
  account_type TEXT,
  rm_name TEXT,
  department TEXT,
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
DECLARE
  v_from_trade DATE;
  v_to_trade DATE;
  v_from_tx DATE;
  v_to_tx DATE;
  v_from_trade_str TEXT;
  v_to_trade_str TEXT;
BEGIN
  -- Parse date parameters
  v_from_trade := CASE WHEN _from_trade_date IS NOT NULL AND _from_trade_date <> '' 
                       THEN _from_trade_date::DATE ELSE NULL END;
  v_to_trade := CASE WHEN _to_trade_date IS NOT NULL AND _to_trade_date <> '' 
                     THEN _to_trade_date::DATE ELSE NULL END;
  v_from_tx := CASE WHEN _from_tx_date IS NOT NULL AND _from_tx_date <> '' 
                    THEN _from_tx_date::DATE ELSE NULL END;
  v_to_tx := CASE WHEN _to_tx_date IS NOT NULL AND _to_tx_date <> '' 
                  THEN _to_tx_date::DATE ELSE NULL END;
  
  -- Convert dates to YYYYMMDD string format for trade_history comparison
  v_from_trade_str := CASE WHEN v_from_trade IS NOT NULL 
                           THEN TO_CHAR(v_from_trade, 'YYYYMMDD') ELSE NULL END;
  v_to_trade_str := CASE WHEN v_to_trade IS NOT NULL 
                         THEN TO_CHAR(v_to_trade, 'YYYYMMDD') ELSE NULL END;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN th.side = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE (v_from_trade_str IS NULL OR th.trade_date >= v_from_trade_str)
      AND (v_to_trade_str IS NULL OR th.trade_date <= v_to_trade_str)
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (v_from_tx IS NULL OR dw.transaction_date >= v_from_tx)
      AND (v_to_tx IS NULL OR dw.transaction_date <= v_to_tx)
    GROUP BY dw.investor_code
  )
  SELECT 
    c.inv_code AS investor_code,
    c.investor_name,
    COALESCE(i.account_type, '') AS account_type,
    COALESCE(c.rm_name, '') AS rm_name,
    COALESCE(ira.department, '') AS department,
    c.ledger_balance AS opening_balance,
    COALESCE(tx.deposits, 0) AS deposits,
    COALESCE(tx.withdrawals, 0) AS withdrawals,
    COALESCE(ts.buy_sum, 0) AS gross_buy,
    COALESCE(ts.sell_sum, 0) AS gross_sell,
    (c.ledger_balance + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
     - COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) AS closing_balance
  FROM clients c
  LEFT JOIN trade_sums ts ON ts.client_code = c.inv_code
  LEFT JOIN tx_sums tx ON tx.investor_code = c.inv_code
  LEFT JOIN investors i ON i.investor_code = c.inv_code
  LEFT JOIN LATERAL (
    SELECT ira_inner.department
    FROM investor_rm_assignments ira_inner
    WHERE ira_inner.investor_code = c.inv_code
    LIMIT 1
  ) ira ON true
  WHERE (_search IS NULL OR _search = '' OR 
         c.inv_code ILIKE '%' || _search || '%' OR 
         c.investor_name ILIKE '%' || _search || '%' OR
         c.rm_name ILIKE '%' || _search || '%' OR
         COALESCE(i.account_type, '') ILIKE '%' || _search || '%' OR
         COALESCE(ira.department, '') ILIKE '%' || _search || '%')
  ORDER BY c.inv_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;