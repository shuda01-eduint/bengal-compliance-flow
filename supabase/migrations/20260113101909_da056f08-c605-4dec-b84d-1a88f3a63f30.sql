-- Drop existing function first due to return type change
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer);

-- Recreate with fixed DATE casting and case-insensitive transaction types
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_trade_date text,
  _to_trade_date text,
  _from_tx_date text,
  _to_tx_date text,
  _search text DEFAULT ''::text,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  rm text,
  account_type text,
  department text,
  opening_balance numeric,
  closing_balance numeric,
  balance_change numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  net_deposits numeric,
  buy_turnover numeric,
  sell_turnover numeric,
  net_turnover numeric,
  brokerage numeric,
  trade_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH active_investors AS (
    SELECT DISTINCT i.investor_code, i.investor_name, i.rm, i.account_type, i.department
    FROM investors i
    WHERE EXISTS (
      SELECT 1 FROM trade_history th
      WHERE th.client_code = i.investor_code
        AND (
          (_from_trade_date = '' OR th.trade_date >= _from_trade_date)
          AND (_to_trade_date = '' OR th.trade_date <= _to_trade_date)
        )
    )
    OR EXISTS (
      SELECT 1 FROM deposits_withdrawals dw
      WHERE dw.investor_code = i.investor_code
        AND (
          (_from_tx_date = '' OR dw.transaction_date >= NULLIF(_from_tx_date, '')::date)
          AND (_to_tx_date = '' OR dw.transaction_date <= NULLIF(_to_tx_date, '')::date)
        )
    )
  ),
  trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.bs_indicator) = 'B' THEN COALESCE(th.traded_value, 0) ELSE 0 END) AS buy_turnover,
      SUM(CASE WHEN UPPER(th.bs_indicator) = 'S' THEN COALESCE(th.traded_value, 0) ELSE 0 END) AS sell_turnover,
      SUM(COALESCE(th.brokerage, 0)) AS brokerage,
      COUNT(*) AS trade_count
    FROM trade_history th
    WHERE (_from_trade_date = '' OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date = '' OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date = '' OR dw.transaction_date >= NULLIF(_from_tx_date, '')::date)
      AND (_to_tx_date = '' OR dw.transaction_date <= NULLIF(_to_tx_date, '')::date)
    GROUP BY dw.investor_code
  ),
  balance_data AS (
    SELECT
      b.investor_code,
      COALESCE(b.ledger_balance, 0) AS closing_balance
    FROM balances b
  )
  SELECT
    ai.investor_code,
    ai.investor_name,
    ai.rm,
    ai.account_type,
    ai.department,
    COALESCE(bd.closing_balance, 0) - (
      COALESCE(tx.total_deposits, 0) - COALESCE(tx.total_withdrawals, 0)
      + COALESCE(ts.sell_turnover, 0) - COALESCE(ts.buy_turnover, 0)
      - COALESCE(ts.brokerage, 0)
    ) AS opening_balance,
    COALESCE(bd.closing_balance, 0) AS closing_balance,
    (
      COALESCE(tx.total_deposits, 0) - COALESCE(tx.total_withdrawals, 0)
      + COALESCE(ts.sell_turnover, 0) - COALESCE(ts.buy_turnover, 0)
      - COALESCE(ts.brokerage, 0)
    ) AS balance_change,
    COALESCE(tx.total_deposits, 0) AS total_deposits,
    COALESCE(tx.total_withdrawals, 0) AS total_withdrawals,
    COALESCE(tx.total_deposits, 0) - COALESCE(tx.total_withdrawals, 0) AS net_deposits,
    COALESCE(ts.buy_turnover, 0) AS buy_turnover,
    COALESCE(ts.sell_turnover, 0) AS sell_turnover,
    COALESCE(ts.sell_turnover, 0) - COALESCE(ts.buy_turnover, 0) AS net_turnover,
    COALESCE(ts.brokerage, 0) AS brokerage,
    COALESCE(ts.trade_count, 0) AS trade_count
  FROM active_investors ai
  LEFT JOIN trade_sums ts ON ts.client_code = ai.investor_code
  LEFT JOIN tx_sums tx ON tx.investor_code = ai.investor_code
  LEFT JOIN balance_data bd ON bd.investor_code = ai.investor_code
  WHERE (
    _search = ''
    OR ai.investor_code ILIKE '%' || _search || '%'
    OR ai.investor_name ILIKE '%' || _search || '%'
    OR ai.rm ILIKE '%' || _search || '%'
  )
  ORDER BY ai.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$function$;