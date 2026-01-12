-- Drop all existing versions of get_accounting_data function
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_data();

-- Recreate the function without department reference
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _limit_val integer DEFAULT 50,
  _offset_val integer DEFAULT 0,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _account_type_filter text DEFAULT 'all',
  _has_trades_filter text DEFAULT 'all'
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  department text,
  opening_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_commission numeric,
  brokerage_amount numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  final_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_dt date;
  to_dt date;
  opening_dt date;
  total bigint;
BEGIN
  -- Parse dates with defaults
  from_dt := COALESCE(NULLIF(_from_trade_date, '')::date, CURRENT_DATE);
  to_dt := COALESCE(NULLIF(_to_trade_date, '')::date, CURRENT_DATE);
  opening_dt := from_dt - INTERVAL '1 day';

  -- Count total matching rows
  SELECT COUNT(DISTINCT i.investor_code) INTO total
  FROM investors i
  WHERE (NULLIF(_search, '') IS NULL 
         OR i.investor_code ILIKE '%' || _search || '%' 
         OR i.investor_name ILIKE '%' || _search || '%')
    AND (_account_type_filter = 'all' 
         OR (_account_type_filter = 'cash' AND (COALESCE(i.account_type, '') NOT ILIKE '%margin%'))
         OR (_account_type_filter = 'margin' AND (COALESCE(i.account_type, '') ILIKE '%margin%')));

  RETURN QUERY
  WITH trade_agg AS (
    SELECT
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_sell
    FROM trade_history th
    WHERE th.trade_date::date BETWEEN from_dt AND to_dt
    GROUP BY th.client_code
  ),
  dep_agg AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date::date BETWEEN from_dt AND to_dt
    GROUP BY dw.investor_code
  ),
  opening_bal AS (
    SELECT
      es.investor_code,
      es.ledger_balance AS opening_ledger
    FROM eod_ledger_snapshots es
    WHERE es.eod_date = opening_dt
  ),
  base_data AS (
    SELECT
      i.investor_code AS inv_code,
      i.investor_name AS inv_name,
      COALESCE(i.account_type, 'Cash') AS acct_type,
      '' AS dept,
      COALESCE(ob.opening_ledger, 0) AS open_bal,
      COALESCE(ta.gross_buy, 0) AS g_buy,
      COALESCE(ta.gross_sell, 0) AS g_sell,
      COALESCE(i.brokerage_commission, 0) AS comm_rate,
      COALESCE(da.deposits, 0) AS deps,
      COALESCE(da.withdrawals, 0) AS wdrw
    FROM investors i
    LEFT JOIN opening_bal ob ON ob.investor_code = i.investor_code
    LEFT JOIN trade_agg ta ON ta.client_code = i.investor_code
    LEFT JOIN dep_agg da ON da.investor_code = i.investor_code
    WHERE (NULLIF(_search, '') IS NULL 
           OR i.investor_code ILIKE '%' || _search || '%' 
           OR i.investor_name ILIKE '%' || _search || '%')
      AND (_account_type_filter = 'all' 
           OR (_account_type_filter = 'cash' AND (COALESCE(i.account_type, '') NOT ILIKE '%margin%'))
           OR (_account_type_filter = 'margin' AND (COALESCE(i.account_type, '') ILIKE '%margin%')))
      AND (_has_trades_filter = 'all'
           OR (_has_trades_filter = 'with_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) > 0))
           OR (_has_trades_filter = 'no_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) = 0)))
  ),
  computed AS (
    SELECT
      bd.inv_code,
      bd.inv_name,
      bd.acct_type,
      bd.dept,
      bd.open_bal,
      bd.g_buy,
      bd.g_sell,
      -- Net buy/sell includes commission
      bd.g_buy * (1 + bd.comm_rate) AS n_buy,
      bd.g_sell * (1 - bd.comm_rate) AS n_sell,
      bd.comm_rate,
      -- Brokerage amount on both buy and sell
      (bd.g_buy + bd.g_sell) * bd.comm_rate AS brk_amt,
      bd.deps,
      bd.wdrw,
      -- Final balance: opening + deposits - withdrawals + gross_sell - gross_buy - brokerage
      bd.open_bal + bd.deps - bd.wdrw + bd.g_sell - bd.g_buy - ((bd.g_buy + bd.g_sell) * bd.comm_rate) AS fin_bal
    FROM base_data bd
  )
  SELECT
    c.inv_code::text,
    c.inv_name::text,
    c.acct_type::text,
    c.dept::text,
    ROUND(c.open_bal, 2)::numeric,
    ROUND(c.g_buy, 2)::numeric,
    ROUND(c.g_sell, 2)::numeric,
    ROUND(c.n_buy, 2)::numeric,
    ROUND(c.n_sell, 2)::numeric,
    c.comm_rate::numeric,
    ROUND(c.brk_amt, 2)::numeric,
    ROUND(c.deps, 2)::numeric,
    ROUND(c.wdrw, 2)::numeric,
    ROUND(c.fin_bal, 2)::numeric,
    total
  FROM computed c
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.inv_name
        WHEN 'account_type' THEN c.acct_type
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.inv_name
        WHEN 'account_type' THEN c.acct_type
        ELSE NULL
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'opening_balance' THEN c.open_bal
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_amount' THEN c.brk_amt
        WHEN 'total_deposits' THEN c.deps
        WHEN 'total_withdrawals' THEN c.wdrw
        WHEN 'final_balance' THEN c.fin_bal
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'opening_balance' THEN c.open_bal
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_amount' THEN c.brk_amt
        WHEN 'total_deposits' THEN c.deps
        WHEN 'total_withdrawals' THEN c.wdrw
        WHEN 'final_balance' THEN c.fin_bal
        ELSE NULL
      END
    END DESC NULLS LAST,
    c.inv_code ASC
  LIMIT _limit_val
  OFFSET _offset_val;
END;
$$;