-- Drop and recreate get_accounting_data with fixed opening balance and commission math
DROP FUNCTION IF EXISTS public.get_accounting_data(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search TEXT DEFAULT '',
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
  _account_type_filter TEXT DEFAULT 'all',
  _has_trades_filter TEXT DEFAULT 'with_activity',
  _sort_column TEXT DEFAULT 'investor_code',
  _sort_direction TEXT DEFAULT 'asc',
  _limit_val INT DEFAULT 50,
  _offset_val INT DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  department TEXT,
  account_type TEXT,
  opening_balance NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  net_buy NUMERIC,
  net_sell NUMERIC,
  brokerage_commission NUMERIC,
  brokerage_amount NUMERIC,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  final_balance NUMERIC,
  total_count BIGINT
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
BEGIN
  -- Parse date parameters
  v_from_trade := CASE WHEN _from_trade_date IS NOT NULL AND _from_trade_date <> '' THEN TO_DATE(_from_trade_date, 'YYYYMMDD') ELSE CURRENT_DATE END;
  v_to_trade := CASE WHEN _to_trade_date IS NOT NULL AND _to_trade_date <> '' THEN TO_DATE(_to_trade_date, 'YYYYMMDD') ELSE CURRENT_DATE END;
  v_from_tx := CASE WHEN _from_tx_date IS NOT NULL AND _from_tx_date <> '' THEN _from_tx_date::DATE ELSE CURRENT_DATE END;
  v_to_tx := CASE WHEN _to_tx_date IS NOT NULL AND _to_tx_date <> '' THEN _to_tx_date::DATE ELSE CURRENT_DATE END;

  RETURN QUERY
  WITH
  -- Get opening balance from eod_ledger_snapshots for the day BEFORE from_trade_date
  eod_opening AS (
    SELECT e.investor_code, e.ledger_balance
    FROM eod_ledger_snapshots e
    WHERE e.eod_date = (v_from_trade - INTERVAL '1 day')::date
  ),
  -- Trade aggregation
  trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('BUY','B') THEN COALESCE(th.value, 0) ELSE 0 END) AS g_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('SELL','S') THEN COALESCE(th.value, 0) ELSE 0 END) AS g_sell
    FROM trade_history th
    WHERE th.trade_date >= TO_CHAR(v_from_trade, 'YYYYMMDD')
      AND th.trade_date <= TO_CHAR(v_to_trade, 'YYYYMMDD')
    GROUP BY th.client_code
  ),
  -- Deposit/withdrawal aggregation
  tx_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) LIKE '%deposit%' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) LIKE '%withdraw%' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date >= v_from_tx
      AND dw.transaction_date <= v_to_tx
    GROUP BY dw.investor_code
  ),
  -- Base data joining investors with aggregations
  base_data AS (
    SELECT
      i.investor_code,
      i.investor_name,
      i.department,
      i.account_type,
      COALESCE(eo.ledger_balance, 0) AS opening_bal,
      COALESCE(ts.g_buy, 0) AS g_buy,
      COALESCE(ts.g_sell, 0) AS g_sell,
      COALESCE(i.brokerage_commission, 0) AS broker_comm,
      COALESCE(tx.deposits, 0) AS deposits,
      COALESCE(tx.withdrawals, 0) AS withdrawals,
      -- Has activity flag
      (COALESCE(ts.g_buy, 0) + COALESCE(ts.g_sell, 0) + COALESCE(tx.deposits, 0) + COALESCE(tx.withdrawals, 0)) > 0 AS has_activity
    FROM investors i
    LEFT JOIN eod_opening eo ON eo.investor_code = i.investor_code
    LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
    LEFT JOIN tx_sums tx ON tx.investor_code = i.investor_code
    WHERE i.investor_code IS NOT NULL
      AND (
        _search IS NULL OR _search = ''
        OR i.investor_code ILIKE '%' || _search || '%'
        OR i.investor_name ILIKE '%' || _search || '%'
      )
      AND (
        _account_type_filter = 'all'
        OR LOWER(COALESCE(i.account_type, '')) = LOWER(_account_type_filter)
      )
  ),
  -- Calculate derived values (commission NOT divided by 100 - it's already a decimal)
  calculated AS (
    SELECT
      bd.investor_code,
      bd.investor_name,
      bd.department,
      bd.account_type,
      bd.opening_bal,
      bd.g_buy,
      bd.g_sell,
      bd.g_buy * (1 + bd.broker_comm) AS n_buy,
      bd.g_sell * (1 - bd.broker_comm) AS n_sell,
      bd.broker_comm,
      (bd.g_buy + bd.g_sell) * bd.broker_comm AS broker_amt,
      bd.deposits,
      bd.withdrawals,
      bd.has_activity
    FROM base_data bd
  ),
  -- Apply has_trades filter
  filtered AS (
    SELECT *
    FROM calculated c
    WHERE (
      _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_activity' AND c.has_activity = true)
      OR (_has_trades_filter = 'no_activity' AND c.has_activity = false)
    )
  ),
  -- Calculate final balance
  final AS (
    SELECT
      f.investor_code,
      f.investor_name,
      f.department,
      f.account_type,
      f.opening_bal,
      f.g_buy,
      f.g_sell,
      f.n_buy,
      f.n_sell,
      f.broker_comm,
      f.broker_amt,
      f.deposits,
      f.withdrawals,
      -- Final balance = opening + deposits - withdrawals + net_sell - net_buy
      f.opening_bal + f.deposits - f.withdrawals + f.n_sell - f.n_buy AS final_bal,
      COUNT(*) OVER() AS total_cnt
    FROM filtered f
  )
  SELECT
    final.investor_code,
    final.investor_name,
    final.department,
    final.account_type,
    ROUND(final.opening_bal, 2) AS opening_balance,
    ROUND(final.g_buy, 2) AS gross_buy,
    ROUND(final.g_sell, 2) AS gross_sell,
    ROUND(final.n_buy, 2) AS net_buy,
    ROUND(final.n_sell, 2) AS net_sell,
    final.broker_comm AS brokerage_commission,
    ROUND(final.broker_amt, 2) AS brokerage_amount,
    ROUND(final.deposits, 2) AS total_deposits,
    ROUND(final.withdrawals, 2) AS total_withdrawals,
    ROUND(final.final_bal, 2) AS final_balance,
    final.total_cnt AS total_count
  FROM final
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN final.investor_code
        WHEN 'investor_name' THEN final.investor_name
        WHEN 'department' THEN final.department
        WHEN 'account_type' THEN final.account_type
        ELSE final.investor_code
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN final.investor_code
        WHEN 'investor_name' THEN final.investor_name
        WHEN 'department' THEN final.department
        WHEN 'account_type' THEN final.account_type
        ELSE final.investor_code
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'opening_balance' THEN final.opening_bal
        WHEN 'gross_buy' THEN final.g_buy
        WHEN 'gross_sell' THEN final.g_sell
        WHEN 'net_buy' THEN final.n_buy
        WHEN 'net_sell' THEN final.n_sell
        WHEN 'brokerage_amount' THEN final.broker_amt
        WHEN 'total_deposits' THEN final.deposits
        WHEN 'total_withdrawals' THEN final.withdrawals
        WHEN 'final_balance' THEN final.final_bal
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'opening_balance' THEN final.opening_bal
        WHEN 'gross_buy' THEN final.g_buy
        WHEN 'gross_sell' THEN final.g_sell
        WHEN 'net_buy' THEN final.n_buy
        WHEN 'net_sell' THEN final.n_sell
        WHEN 'brokerage_amount' THEN final.broker_amt
        WHEN 'total_deposits' THEN final.deposits
        WHEN 'total_withdrawals' THEN final.withdrawals
        WHEN 'final_balance' THEN final.final_bal
        ELSE NULL
      END
    END DESC NULLS LAST
  LIMIT _limit_val
  OFFSET _offset_val;
END;
$$;