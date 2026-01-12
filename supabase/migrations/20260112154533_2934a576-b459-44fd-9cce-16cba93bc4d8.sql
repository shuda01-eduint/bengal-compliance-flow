
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_date date,
  _to_date date,
  _search text DEFAULT NULL,
  _account_type text DEFAULT NULL,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _page_offset integer DEFAULT 0,
  _page_limit integer DEFAULT 50
)
RETURNS TABLE(
  investor_id uuid,
  investor_code text,
  investor_name text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  ledger_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_amount numeric,
  accrued_interest numeric,
  adjusted_ledger numeric,
  final_balance numeric,
  receivable numeric,
  payable numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(DISTINCT i.id) INTO _total
  FROM investors i
  LEFT JOIN investor_balances ib ON i.id = ib.investor_id
    AND ib.balance_date = (
      SELECT MAX(ib2.balance_date)
      FROM investor_balances ib2
      WHERE ib2.investor_id = i.id
        AND ib2.balance_date <= _to_date
    )
  WHERE (
    _search IS NULL
    OR i.investor_code ILIKE '%' || _search || '%'
    OR i.name ILIKE '%' || _search || '%'
  )
  AND (
    _account_type IS NULL
    OR i.account_type = _account_type
  );

  RETURN QUERY
  WITH filtered_data AS (
    SELECT
      i.id AS inv_id,
      i.investor_code AS inv_code,
      i.name AS inv_name,
      i.account_type AS acc_type,
      COALESCE(i.interest_rate, 0) AS int_rate,
      COALESCE(i.brokerage_commission, 0) AS commission_rate,
      COALESCE(ib.ledger_balance, 0) AS ledger_bal,
      COALESCE(
        (SELECT SUM(t.gross_value)
         FROM trades t
         WHERE t.investor_id = i.id
           AND t.trade_type = 'buy'
           AND t.trade_date BETWEEN _from_date AND _to_date),
        0
      ) AS buy_val,
      COALESCE(
        (SELECT SUM(t.gross_value)
         FROM trades t
         WHERE t.investor_id = i.id
           AND t.trade_type = 'sell'
           AND t.trade_date BETWEEN _from_date AND _to_date),
        0
      ) AS sell_val,
      COALESCE(
        (SELECT SUM(t.net_value)
         FROM trades t
         WHERE t.investor_id = i.id
           AND t.trade_type = 'buy'
           AND t.trade_date BETWEEN _from_date AND _to_date),
        0
      ) AS net_buy_val,
      COALESCE(
        (SELECT SUM(t.net_value)
         FROM trades t
         WHERE t.investor_id = i.id
           AND t.trade_type = 'sell'
           AND t.trade_date BETWEEN _from_date AND _to_date),
        0
      ) AS net_sell_val,
      COALESCE(
        (SELECT SUM(t.brokerage)
         FROM trades t
         WHERE t.investor_id = i.id
           AND t.trade_date BETWEEN _from_date AND _to_date),
        0
      ) AS brokerage,
      COALESCE(
        (SELECT SUM(tx.amount)
         FROM investor_transactions tx
         WHERE tx.investor_id = i.id
           AND tx.transaction_type = 'interest'
           AND tx.transaction_date BETWEEN _from_date AND _to_date),
        0
      ) AS accrued_int,
      COALESCE(
        (SELECT SUM(tx.amount)
         FROM investor_transactions tx
         WHERE tx.investor_id = i.id
           AND tx.transaction_type = 'deposit'
           AND tx.transaction_date BETWEEN _from_date AND _to_date),
        0
      ) AS dep_val,
      COALESCE(
        (SELECT SUM(tx.amount)
         FROM investor_transactions tx
         WHERE tx.investor_id = i.id
           AND tx.transaction_type = 'withdrawal'
           AND tx.transaction_date BETWEEN _from_date AND _to_date),
        0
      ) AS wd_val
    FROM investors i
    LEFT JOIN investor_balances ib ON i.id = ib.investor_id
      AND ib.balance_date = (
        SELECT MAX(ib2.balance_date)
        FROM investor_balances ib2
        WHERE ib2.investor_id = i.id
          AND ib2.balance_date <= _to_date
      )
    WHERE (
      _search IS NULL
      OR i.investor_code ILIKE '%' || _search || '%'
      OR i.name ILIKE '%' || _search || '%'
    )
    AND (
      _account_type IS NULL
      OR i.account_type = _account_type
    )
  )
  SELECT
    fd.inv_id,
    fd.inv_code,
    fd.inv_name,
    fd.acc_type,
    fd.int_rate,
    fd.commission_rate,
    fd.ledger_bal,
    fd.buy_val,
    fd.sell_val,
    fd.net_buy_val,
    fd.net_sell_val,
    fd.brokerage,
    fd.accrued_int,
    fd.ledger_bal + fd.net_sell_val - fd.net_buy_val AS adj_ledger,
    fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int AS final_bal,
    GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0) AS recv,
    GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0) AS pay,
    fd.dep_val,
    fd.wd_val,
    _total
  FROM filtered_data fd
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN fd.inv_code
        WHEN 'investor_name' THEN fd.inv_name
        WHEN 'account_type' THEN fd.acc_type
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN fd.inv_code
        WHEN 'investor_name' THEN fd.inv_name
        WHEN 'account_type' THEN fd.acc_type
        ELSE NULL
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN fd.ledger_bal
        WHEN 'gross_buy' THEN fd.buy_val
        WHEN 'gross_sell' THEN fd.sell_val
        WHEN 'brokerage_amount' THEN fd.brokerage
        WHEN 'adjusted_ledger' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val
        WHEN 'final_balance' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int
        WHEN 'receivable' THEN GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0)
        WHEN 'payable' THEN GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0)
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN fd.ledger_bal
        WHEN 'gross_buy' THEN fd.buy_val
        WHEN 'gross_sell' THEN fd.sell_val
        WHEN 'brokerage_amount' THEN fd.brokerage
        WHEN 'adjusted_ledger' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val
        WHEN 'final_balance' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int
        WHEN 'receivable' THEN GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0)
        WHEN 'payable' THEN GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0)
        ELSE NULL
      END
    END DESC NULLS LAST,
    fd.inv_code ASC
  OFFSET _page_offset
  LIMIT _page_limit;
END;
$$;
