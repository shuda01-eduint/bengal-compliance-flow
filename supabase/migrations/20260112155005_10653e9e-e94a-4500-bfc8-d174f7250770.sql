CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _page_offset integer DEFAULT 0,
  _page_size integer DEFAULT 50
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  ledger_balance numeric,
  interest_rate numeric,
  brokerage_commission numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  payable numeric,
  receivable numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  accrued_interest numeric,
  adjusted_ledger numeric,
  brokerage_amount numeric,
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
  v_from_trade := CASE WHEN _from_trade_date IS NOT NULL THEN _from_trade_date::date ELSE NULL END;
  v_to_trade := CASE WHEN _to_trade_date IS NOT NULL THEN _to_trade_date::date ELSE NULL END;
  v_from_tx := CASE WHEN _from_tx_date IS NOT NULL THEN _from_tx_date::date ELSE NULL END;
  v_to_tx := CASE WHEN _to_tx_date IS NOT NULL THEN _to_tx_date::date ELSE NULL END;

  RETURN QUERY
  WITH investor_base AS (
    SELECT
      i.investor_code AS inv_code,
      i.investor_name AS inv_name,
      COALESCE(i.account_type, 'Regular') AS acc_type,
      COALESCE(i.interest_rate, 0) AS int_rate,
      COALESCE(i.brokerage_commission, 0) AS brk_comm
    FROM investors i
    WHERE i.status IS DISTINCT FROM 'Inactive'
  ),
  client_ledger AS (
    SELECT
      c.inv_code,
      c.ledger_balance
    FROM clients c
  ),
  trade_agg AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell
    FROM trade_history th
    WHERE (v_from_trade IS NULL OR th.trade_date::date >= v_from_trade)
      AND (v_to_trade IS NULL OR th.trade_date::date <= v_to_trade)
    GROUP BY th.client_code
  ),
  dep_with AS (
    SELECT
      dw.investor_code AS inv_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) AS deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (v_from_tx IS NULL OR dw.transaction_date::date >= v_from_tx)
      AND (v_to_tx IS NULL OR dw.transaction_date::date <= v_to_tx)
    GROUP BY dw.investor_code
  ),
  final_data AS (
    SELECT
      ib.inv_code,
      ib.inv_name,
      ib.acc_type,
      COALESCE(cl.ledger_balance, 0) AS ledger_bal,
      ib.int_rate,
      ib.brk_comm,
      COALESCE(ta.gross_buy, 0) AS g_buy,
      COALESCE(ta.gross_sell, 0) AS g_sell,
      COALESCE(dw.deposits, 0) AS deps,
      COALESCE(dw.withdrawals, 0) AS withs,
      CASE WHEN ib.acc_type = 'Margin' AND COALESCE(cl.ledger_balance, 0) < 0
           THEN ABS(COALESCE(cl.ledger_balance, 0)) * (ib.int_rate / 100.0) / 365.0
           ELSE 0
      END AS acc_int,
      (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0)) * (ib.brk_comm / 100.0) AS brk_amt
    FROM investor_base ib
    LEFT JOIN client_ledger cl ON cl.inv_code = ib.inv_code
    LEFT JOIN trade_agg ta ON ta.client_code = ib.inv_code
    LEFT JOIN dep_with dw ON dw.inv_code = ib.inv_code
  ),
  counted AS (
    SELECT
      fd.*,
      fd.ledger_bal + fd.deps - fd.withs AS adj_ledger,
      fd.g_buy - fd.brk_amt AS n_buy,
      fd.g_sell - fd.brk_amt AS n_sell,
      CASE WHEN fd.g_buy > fd.g_sell THEN fd.g_buy - fd.g_sell ELSE 0 END AS payable_amt,
      CASE WHEN fd.g_sell > fd.g_buy THEN fd.g_sell - fd.g_buy ELSE 0 END AS receivable_amt,
      fd.ledger_bal + fd.deps - fd.withs + fd.acc_int - fd.brk_amt AS final_bal,
      COUNT(*) OVER() AS cnt
    FROM final_data fd
    WHERE (
      _search_term IS NULL
      OR fd.inv_code ILIKE '%' || _search_term || '%'
      OR fd.inv_name ILIKE '%' || _search_term || '%'
    )
    AND (
      _account_type_filter IS NULL
      OR _account_type_filter = 'all'
      OR fd.acc_type = _account_type_filter
    )
    AND (
      _has_trades_filter IS NULL
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_trades' AND (fd.g_buy > 0 OR fd.g_sell > 0))
      OR (_has_trades_filter = 'without_trades' AND fd.g_buy = 0 AND fd.g_sell = 0)
    )
  )
  SELECT
    fd.inv_code,
    fd.inv_name,
    fd.acc_type,
    fd.ledger_bal,
    fd.int_rate,
    fd.brk_comm,
    fd.g_buy,
    fd.g_sell,
    fd.n_buy,
    fd.n_sell,
    fd.payable_amt,
    fd.receivable_amt,
    fd.deps,
    fd.withs,
    fd.acc_int,
    fd.adj_ledger,
    fd.brk_amt,
    fd.final_bal,
    fd.cnt
  FROM counted fd
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
        WHEN 'interest_rate' THEN fd.int_rate
        WHEN 'brokerage_commission' THEN fd.brk_comm
        WHEN 'gross_buy' THEN fd.g_buy
        WHEN 'gross_sell' THEN fd.g_sell
        WHEN 'net_buy' THEN fd.n_buy
        WHEN 'net_sell' THEN fd.n_sell
        WHEN 'payable' THEN fd.payable_amt
        WHEN 'receivable' THEN fd.receivable_amt
        WHEN 'total_deposits' THEN fd.deps
        WHEN 'total_withdrawals' THEN fd.withs
        WHEN 'accrued_interest' THEN fd.acc_int
        WHEN 'adjusted_ledger' THEN fd.adj_ledger
        WHEN 'brokerage_amount' THEN fd.brk_amt
        WHEN 'final_balance' THEN fd.final_bal
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN fd.ledger_bal
        WHEN 'interest_rate' THEN fd.int_rate
        WHEN 'brokerage_commission' THEN fd.brk_comm
        WHEN 'gross_buy' THEN fd.g_buy
        WHEN 'gross_sell' THEN fd.g_sell
        WHEN 'net_buy' THEN fd.n_buy
        WHEN 'net_sell' THEN fd.n_sell
        WHEN 'payable' THEN fd.payable_amt
        WHEN 'receivable' THEN fd.receivable_amt
        WHEN 'total_deposits' THEN fd.deps
        WHEN 'total_withdrawals' THEN fd.withs
        WHEN 'accrued_interest' THEN fd.acc_int
        WHEN 'adjusted_ledger' THEN fd.adj_ledger
        WHEN 'brokerage_amount' THEN fd.brk_amt
        WHEN 'final_balance' THEN fd.final_bal
        ELSE NULL
      END
    END DESC NULLS LAST,
    fd.inv_code ASC
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;