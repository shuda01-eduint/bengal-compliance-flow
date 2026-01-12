-- Drop all existing versions of get_accounting_data to resolve "function is not unique" error
DROP FUNCTION IF EXISTS public.get_accounting_data(date, date, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, text, text, integer, integer, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, text, text, text, text, integer, integer);

-- Recreate single correct version with fixed sorting
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _search_term text DEFAULT NULL,
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT NULL,
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
  total_deposits numeric,
  total_withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_commission numeric,
  brokerage_amount numeric,
  interest_rate numeric,
  accrued_interest numeric,
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
  total_rows bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(DISTINCT i.investor_code) INTO total_rows
  FROM investors i
  LEFT JOIN clients c ON c.inv_code = i.investor_code
  LEFT JOIN trade_history th ON th.client_code = i.investor_code
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date::date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date::date)
  LEFT JOIN deposits_withdrawals dw ON dw.investor_code = i.investor_code
    AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
    AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
  WHERE
    (_search_term IS NULL OR _search_term = '' OR 
      i.investor_code ILIKE '%' || _search_term || '%' OR 
      i.investor_name ILIKE '%' || _search_term || '%')
    AND (_account_type_filter IS NULL OR _account_type_filter = '' OR _account_type_filter = 'all' OR i.account_type = _account_type_filter)
    AND (
      _has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_trades' AND EXISTS (
        SELECT 1 FROM trade_history th2 
        WHERE th2.client_code = i.investor_code
          AND (_from_trade_date IS NULL OR th2.trade_date >= _from_trade_date::date)
          AND (_to_trade_date IS NULL OR th2.trade_date <= _to_trade_date::date)
      ))
      OR (_has_trades_filter = 'without_trades' AND NOT EXISTS (
        SELECT 1 FROM trade_history th2 
        WHERE th2.client_code = i.investor_code
          AND (_from_trade_date IS NULL OR th2.trade_date >= _from_trade_date::date)
          AND (_to_trade_date IS NULL OR th2.trade_date <= _to_trade_date::date)
      ))
    );

  RETURN QUERY
  WITH filtered_data AS (
    SELECT
      i.investor_code AS inv_code,
      i.investor_name AS inv_name,
      COALESCE(i.account_type, 'Unknown') AS acc_type,
      COALESCE(c.ledger_balance, 0) AS ledger_bal,
      COALESCE(i.brokerage_commission, 0) AS broker_comm,
      COALESCE(i.interest_rate, 0) AS int_rate
    FROM investors i
    LEFT JOIN clients c ON c.inv_code = i.investor_code
    WHERE
      (_search_term IS NULL OR _search_term = '' OR 
        i.investor_code ILIKE '%' || _search_term || '%' OR 
        i.investor_name ILIKE '%' || _search_term || '%')
      AND (_account_type_filter IS NULL OR _account_type_filter = '' OR _account_type_filter = 'all' OR i.account_type = _account_type_filter)
      AND (
        _has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all'
        OR (_has_trades_filter = 'with_trades' AND EXISTS (
          SELECT 1 FROM trade_history th2 
          WHERE th2.client_code = i.investor_code
            AND (_from_trade_date IS NULL OR th2.trade_date >= _from_trade_date::date)
            AND (_to_trade_date IS NULL OR th2.trade_date <= _to_trade_date::date)
        ))
        OR (_has_trades_filter = 'without_trades' AND NOT EXISTS (
          SELECT 1 FROM trade_history th2 
          WHERE th2.client_code = i.investor_code
            AND (_from_trade_date IS NULL OR th2.trade_date >= _from_trade_date::date)
            AND (_to_trade_date IS NULL OR th2.trade_date <= _to_trade_date::date)
        ))
      )
  ),
  trade_aggs AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN COALESCE(th.value, 0) + COALESCE(th.brokerage_commission, 0) ELSE 0 END) AS net_buy,
      SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN COALESCE(th.value, 0) - COALESCE(th.brokerage_commission, 0) ELSE 0 END) AS net_sell
    FROM trade_history th
    WHERE
      (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date::date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date::date)
    GROUP BY th.client_code
  ),
  deposit_aggs AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE
      (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  combined AS (
    SELECT
      fd.inv_code,
      fd.inv_name,
      fd.acc_type,
      fd.ledger_bal,
      COALESCE(da.total_deposits, 0) AS total_deps,
      COALESCE(da.total_withdrawals, 0) AS total_wds,
      COALESCE(ta.gross_buy, 0) AS g_buy,
      COALESCE(ta.gross_sell, 0) AS g_sell,
      COALESCE(ta.net_buy, 0) AS n_buy,
      COALESCE(ta.net_sell, 0) AS n_sell,
      fd.broker_comm,
      (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0)) * fd.broker_comm / 100 AS broker_amt,
      fd.int_rate,
      CASE 
        WHEN fd.ledger_bal < 0 THEN ABS(fd.ledger_bal) * fd.int_rate / 100 / 365
        ELSE 0 
      END AS acc_interest,
      fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) AS adj_ledger,
      CASE 
        WHEN (fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) - COALESCE(ta.net_buy, 0) + COALESCE(ta.net_sell, 0)) < 0 
        THEN ABS(fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) - COALESCE(ta.net_buy, 0) + COALESCE(ta.net_sell, 0))
        ELSE 0 
      END AS payable_amt,
      CASE 
        WHEN (fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) - COALESCE(ta.net_buy, 0) + COALESCE(ta.net_sell, 0)) > 0 
        THEN (fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) - COALESCE(ta.net_buy, 0) + COALESCE(ta.net_sell, 0))
        ELSE 0 
      END AS receivable_amt,
      fd.ledger_bal + COALESCE(da.total_deposits, 0) - COALESCE(da.total_withdrawals, 0) - COALESCE(ta.net_buy, 0) + COALESCE(ta.net_sell, 0) AS final_bal
    FROM filtered_data fd
    LEFT JOIN trade_aggs ta ON ta.client_code = fd.inv_code
    LEFT JOIN deposit_aggs da ON da.investor_code = fd.inv_code
  )
  SELECT
    c.inv_code,
    c.inv_name,
    c.acc_type,
    c.ledger_bal,
    c.total_deps,
    c.total_wds,
    c.g_buy,
    c.g_sell,
    c.n_buy,
    c.n_sell,
    c.broker_comm,
    c.broker_amt,
    c.int_rate,
    c.acc_interest,
    c.adj_ledger,
    c.payable_amt,
    c.receivable_amt,
    c.final_bal,
    total_rows
  FROM combined c
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.inv_name
        WHEN 'account_type' THEN c.acc_type
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.inv_code
        WHEN 'investor_name' THEN c.inv_name
        WHEN 'account_type' THEN c.acc_type
        ELSE NULL
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN c.ledger_bal
        WHEN 'total_deposits' THEN c.total_deps
        WHEN 'total_withdrawals' THEN c.total_wds
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_commission' THEN c.broker_comm
        WHEN 'brokerage_amount' THEN c.broker_amt
        WHEN 'interest_rate' THEN c.int_rate
        WHEN 'accrued_interest' THEN c.acc_interest
        WHEN 'adjusted_ledger' THEN c.adj_ledger
        WHEN 'payable' THEN c.payable_amt
        WHEN 'receivable' THEN c.receivable_amt
        WHEN 'final_balance' THEN c.final_bal
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN c.ledger_bal
        WHEN 'total_deposits' THEN c.total_deps
        WHEN 'total_withdrawals' THEN c.total_wds
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_commission' THEN c.broker_comm
        WHEN 'brokerage_amount' THEN c.broker_amt
        WHEN 'interest_rate' THEN c.int_rate
        WHEN 'accrued_interest' THEN c.acc_interest
        WHEN 'adjusted_ledger' THEN c.adj_ledger
        WHEN 'payable' THEN c.payable_amt
        WHEN 'receivable' THEN c.receivable_amt
        WHEN 'final_balance' THEN c.final_bal
        ELSE NULL
      END
    END DESC NULLS LAST,
    c.inv_code ASC
  OFFSET _page_offset
  LIMIT _page_size;
END;
$$;