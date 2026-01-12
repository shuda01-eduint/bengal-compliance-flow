-- Drop and recreate get_accounting_data with UI-compatible filter handling
DROP FUNCTION IF EXISTS public.get_accounting_data;

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT 'all',
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  ledger_balance numeric,
  accrued_interest numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_amount numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  adjusted_ledger numeric,
  payable numeric,
  receivable numeric,
  final_balance numeric,
  total_count bigint
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
  -- Parse date parameters
  v_from_trade := CASE WHEN _from_trade_date IS NOT NULL AND _from_trade_date <> '' THEN _from_trade_date::date ELSE NULL END;
  v_to_trade := CASE WHEN _to_trade_date IS NOT NULL AND _to_trade_date <> '' THEN _to_trade_date::date ELSE NULL END;
  v_from_tx := CASE WHEN _from_tx_date IS NOT NULL AND _from_tx_date <> '' THEN _from_tx_date::date ELSE NULL END;
  v_to_tx := CASE WHEN _to_tx_date IS NOT NULL AND _to_tx_date <> '' THEN _to_tx_date::date ELSE NULL END;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (v_from_trade IS NULL OR th.trade_date::date >= v_from_trade)
      AND (v_to_trade IS NULL OR th.trade_date::date <= v_to_trade)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code AS inv_code,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (v_from_tx IS NULL OR dw.transaction_date::date >= v_from_tx)
      AND (v_to_tx IS NULL OR dw.transaction_date::date <= v_to_tx)
    GROUP BY dw.investor_code
  ),
  base_data AS (
    SELECT
      i.investor_code AS inv_code,
      i.investor_name AS inv_name,
      COALESCE(i.account_type, 'Cash') AS acct_type,
      COALESCE(i.interest_rate, 0) AS int_rate,
      COALESCE(i.brokerage_commission, 0) AS broker_comm,
      COALESCE(c.ledger_balance, 0) AS client_ledger,
      COALESCE(c.accrued_interest, 0) AS client_interest,
      COALESCE(ts.buy_sum, 0) AS g_buy,
      COALESCE(ts.sell_sum, 0) AS g_sell,
      COALESCE(ds.deposits, 0) AS dep,
      COALESCE(ds.withdrawals, 0) AS wdraw
    FROM investors i
    LEFT JOIN clients c ON c.inv_code = i.investor_code
    LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
    LEFT JOIN deposit_sums ds ON ds.inv_code = i.investor_code
    WHERE i.status = 'Active'
      -- Search filter
      AND (
        _search_term IS NULL 
        OR _search_term = '' 
        OR i.investor_code ILIKE '%' || _search_term || '%'
        OR i.investor_name ILIKE '%' || _search_term || '%'
      )
      -- Account type filter: treat NULL, '', 'all' as no filter; otherwise case-insensitive match
      AND (
        _account_type_filter IS NULL 
        OR _account_type_filter = '' 
        OR LOWER(_account_type_filter) = 'all'
        OR LOWER(COALESCE(i.account_type, 'Cash')) = LOWER(_account_type_filter)
      )
  ),
  computed AS (
    SELECT
      bd.*,
      -- Net values after brokerage
      bd.g_buy * (1 + bd.broker_comm / 100) AS n_buy,
      bd.g_sell * (1 - bd.broker_comm / 100) AS n_sell,
      -- Brokerage amount
      (bd.g_buy + bd.g_sell) * bd.broker_comm / 100 AS broker_amt,
      -- Adjusted ledger = ledger + deposits - withdrawals
      bd.client_ledger + bd.dep - bd.wdraw AS adj_ledger
    FROM base_data bd
  ),
  final_computed AS (
    SELECT
      c.*,
      -- Final balance = adjusted_ledger - net_buy + net_sell
      c.adj_ledger - c.n_buy + c.n_sell AS final_bal,
      -- Activity check for filtering
      (c.g_buy + c.g_sell) AS trade_activity,
      (c.g_buy + c.g_sell + c.dep + c.wdraw) AS total_activity
    FROM computed c
  ),
  filtered AS (
    SELECT *
    FROM final_computed fc
    WHERE (
      -- Activity filter: support both naming conventions
      _has_trades_filter IS NULL
      OR _has_trades_filter = ''
      OR LOWER(_has_trades_filter) = 'all'
      OR (LOWER(_has_trades_filter) = 'with_trades' AND fc.trade_activity > 0)
      OR (LOWER(_has_trades_filter) = 'without_trades' AND fc.trade_activity = 0)
      OR (LOWER(_has_trades_filter) = 'with_activity' AND fc.total_activity > 0)
      OR (LOWER(_has_trades_filter) = 'no_activity' AND fc.total_activity = 0)
    )
  ),
  counted AS (
    SELECT *, count(*) OVER() AS cnt
    FROM filtered
  ),
  sorted AS (
    SELECT *
    FROM counted
    ORDER BY
      CASE WHEN _sort_direction = 'asc' THEN
        CASE _sort_column
          WHEN 'investor_code' THEN inv_code
          WHEN 'investor_name' THEN inv_name
          WHEN 'account_type' THEN acct_type
          ELSE inv_code
        END
      END ASC NULLS LAST,
      CASE WHEN _sort_direction = 'desc' THEN
        CASE _sort_column
          WHEN 'investor_code' THEN inv_code
          WHEN 'investor_name' THEN inv_name
          WHEN 'account_type' THEN acct_type
          ELSE inv_code
        END
      END DESC NULLS LAST,
      CASE WHEN _sort_direction = 'asc' THEN
        CASE _sort_column
          WHEN 'ledger_balance' THEN client_ledger
          WHEN 'gross_buy' THEN g_buy
          WHEN 'gross_sell' THEN g_sell
          WHEN 'net_buy' THEN n_buy
          WHEN 'net_sell' THEN n_sell
          WHEN 'total_deposits' THEN dep
          WHEN 'total_withdrawals' THEN wdraw
          WHEN 'adjusted_ledger' THEN adj_ledger
          WHEN 'final_balance' THEN final_bal
          WHEN 'payable' THEN CASE WHEN final_bal < 0 THEN ABS(final_bal) ELSE 0 END
          WHEN 'receivable' THEN CASE WHEN final_bal > 0 THEN final_bal ELSE 0 END
          ELSE 0
        END
      END ASC NULLS LAST,
      CASE WHEN _sort_direction = 'desc' THEN
        CASE _sort_column
          WHEN 'ledger_balance' THEN client_ledger
          WHEN 'gross_buy' THEN g_buy
          WHEN 'gross_sell' THEN g_sell
          WHEN 'net_buy' THEN n_buy
          WHEN 'net_sell' THEN n_sell
          WHEN 'total_deposits' THEN dep
          WHEN 'total_withdrawals' THEN wdraw
          WHEN 'adjusted_ledger' THEN adj_ledger
          WHEN 'final_balance' THEN final_bal
          WHEN 'payable' THEN CASE WHEN final_bal < 0 THEN ABS(final_bal) ELSE 0 END
          WHEN 'receivable' THEN CASE WHEN final_bal > 0 THEN final_bal ELSE 0 END
          ELSE 0
        END
      END DESC NULLS LAST,
      inv_code ASC
    LIMIT _page_size
    OFFSET _page_offset
  )
  SELECT
    s.inv_code,
    s.inv_name,
    s.acct_type,
    s.int_rate,
    s.broker_comm,
    s.client_ledger,
    s.client_interest,
    s.g_buy,
    s.g_sell,
    s.n_buy,
    s.n_sell,
    s.broker_amt,
    s.dep,
    s.wdraw,
    s.adj_ledger,
    CASE WHEN s.final_bal < 0 THEN ABS(s.final_bal) ELSE 0 END,
    CASE WHEN s.final_bal > 0 THEN s.final_bal ELSE 0 END,
    s.final_bal,
    s.cnt
  FROM sorted s;
END;
$$;