-- Update get_accounting_data to use EOD snapshots for opening/closing balances
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
  WITH 
  -- Opening snapshot: day before from_tx_date (or from_trade_date if tx date not provided)
  opening_snap AS (
    SELECT 
      els.investor_code AS inv_code, 
      els.ledger_balance AS open_bal
    FROM eod_ledger_snapshots els
    WHERE els.eod_date = (
      COALESCE(_from_tx_date, _from_trade_date)::date - INTERVAL '1 day'
    )::date
  ),
  -- Closing snapshot: to_tx_date (or to_trade_date if tx date not provided)
  closing_snap AS (
    SELECT 
      els.investor_code AS inv_code, 
      els.ledger_balance AS close_bal
    FROM eod_ledger_snapshots els
    WHERE els.eod_date = COALESCE(_to_tx_date, _to_trade_date)::date
  ),
  trade_agg AS (
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
      dw.investor_code AS inv_code,
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
    SELECT inv_code as code FROM tx_agg WHERE total_deposits > 0 OR total_withdrawals > 0
  )
  SELECT 
    c.inv_code AS investor_code,
    c.investor_name AS investor_name,
    c.rm_name AS department,
    -- Opening: prefer snapshot (day before), fallback to clients.ledger_balance
    COALESCE(os.open_bal, c.ledger_balance, 0) AS opening_balance,
    COALESCE(tx.total_deposits, 0) AS deposits,
    COALESCE(tx.total_withdrawals, 0) AS withdrawals,
    COALESCE(ta.total_buy, 0) AS gross_buy,
    COALESCE(ta.total_sell, 0) AS gross_sell,
    -- Closing: prefer snapshot, fallback to calculated
    COALESCE(
      cs.close_bal,
      COALESCE(os.open_bal, c.ledger_balance, 0) 
        + COALESCE(tx.total_deposits, 0) 
        - COALESCE(tx.total_withdrawals, 0) 
        - COALESCE(ta.total_buy, 0) 
        + COALESCE(ta.total_sell, 0)
    ) AS closing_balance
  FROM clients c
  INNER JOIN active_codes ac ON c.inv_code = ac.code
  LEFT JOIN trade_agg ta ON c.inv_code = ta.client_code
  LEFT JOIN tx_agg tx ON c.inv_code = tx.inv_code
  LEFT JOIN opening_snap os ON c.inv_code = os.inv_code
  LEFT JOIN closing_snap cs ON c.inv_code = cs.inv_code
  WHERE (_search IS NULL OR _search = '' 
    OR c.inv_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%')
  ORDER BY c.inv_code;
END;
$$;