-- Drop existing function overloads
DROP FUNCTION IF EXISTS public.get_accounting_data(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);

-- Recreate the function with proper DATE casting for transaction_date comparisons
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_date TEXT DEFAULT NULL,
  _to_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
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
  turnover NUMERIC,
  commission NUMERIC,
  margin_balance NUMERIC,
  deposits NUMERIC,
  withdrawals NUMERIC,
  running_balance NUMERIC
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
      COALESCE(SUM(th.turnover), 0) AS turnover,
      COALESCE(SUM(th.commission), 0) AS commission
    FROM trade_history th
    WHERE (_from_date IS NULL OR th.trade_date >= _from_date::DATE)
      AND (_to_date IS NULL OR th.trade_date <= _to_date::DATE)
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::DATE)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::DATE)
    GROUP BY dw.investor_code
  )
  SELECT
    i.investor_code,
    i.name AS investor_name,
    i.rm_name,
    i.department,
    i.account_type,
    COALESCE(i.opening_balance, 0) AS opening_balance,
    COALESCE(ts.turnover, 0) AS turnover,
    COALESCE(ts.commission, 0) AS commission,
    COALESCE(i.margin_balance, 0) AS margin_balance,
    COALESCE(tx.deposits, 0) AS deposits,
    COALESCE(tx.withdrawals, 0) AS withdrawals,
    (COALESCE(i.opening_balance, 0) + COALESCE(ts.turnover, 0) - COALESCE(ts.commission, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0)) AS running_balance
  FROM investors i
  LEFT JOIN trade_sums ts ON i.investor_code = ts.client_code
  LEFT JOIN tx_sums tx ON i.investor_code = tx.investor_code
  WHERE (ts.client_code IS NOT NULL OR tx.investor_code IS NOT NULL)
  ORDER BY i.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;