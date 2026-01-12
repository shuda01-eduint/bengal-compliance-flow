-- Drop and recreate get_accounting_data with fixed type casts for date comparisons
DROP FUNCTION IF EXISTS public.get_accounting_data;

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term TEXT DEFAULT NULL,
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
  _account_type_filter TEXT DEFAULT NULL,
  _has_trades_filter TEXT DEFAULT NULL,
  _sort_column TEXT DEFAULT 'investor_code',
  _sort_direction TEXT DEFAULT 'asc',
  _page_size INT DEFAULT 50,
  _page_offset INT DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  account_type TEXT,
  interest_rate NUMERIC,
  brokerage_commission NUMERIC,
  ledger_balance NUMERIC,
  accrued_interest NUMERIC,
  adjusted_ledger NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  net_buy NUMERIC,
  net_sell NUMERIC,
  brokerage_amount NUMERIC,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  receivable NUMERIC,
  payable NUMERIC,
  final_balance NUMERIC,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total BIGINT;
BEGIN
  -- Count total matching records first
  SELECT COUNT(DISTINCT i.investor_code) INTO total
  FROM investors i
  LEFT JOIN clients c ON i.investor_code = c.inv_code
  LEFT JOIN trade_history th ON i.investor_code = th.client_code
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  WHERE (_search_term IS NULL OR _search_term = '' 
         OR i.investor_code ILIKE '%' || _search_term || '%'
         OR i.investor_name ILIKE '%' || _search_term || '%')
    AND (_account_type_filter IS NULL OR _account_type_filter = '' OR i.account_type = _account_type_filter)
    AND (_has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all'
         OR (_has_trades_filter = 'with_trades' AND th.id IS NOT NULL)
         OR (_has_trades_filter = 'without_trades' AND th.id IS NULL));

  RETURN QUERY
  WITH trade_sums AS (
    SELECT
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' OR UPPER(th.side) = 'B' THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' OR UPPER(th.side) = 'S' THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS sell_sum
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code AS inv_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  opening_ledger AS (
    -- Get opening ledger balance from EOD snapshots (latest before from_trade_date)
    SELECT DISTINCT ON (es.investor_code)
      es.investor_code,
      es.ledger_balance
    FROM eod_ledger_snapshots es
    WHERE _from_trade_date IS NOT NULL 
      AND es.eod_date < _from_trade_date::date
    ORDER BY es.investor_code, es.eod_date DESC
  ),
  base_data AS (
    SELECT
      i.investor_code AS inv_code,
      i.investor_name AS inv_name,
      COALESCE(i.account_type, 'Cash') AS acc_type,
      COALESCE(i.interest_rate, 0) AS int_rate,
      COALESCE(i.brokerage_commission, 0.004) AS broker_comm,
      -- Use opening ledger from EOD snapshot if available, otherwise fall back to clients table
      COALESCE(ol.ledger_balance, c.ledger_balance, 0) AS opening_ledger,
      COALESCE(c.accrued_interest, 0) AS acc_interest,
      COALESCE(ts.buy_sum, 0) AS g_buy,
      COALESCE(ts.sell_sum, 0) AS g_sell,
      COALESCE(ds.deposits, 0) AS tot_deposits,
      COALESCE(ds.withdrawals, 0) AS tot_withdrawals
    FROM investors i
    LEFT JOIN clients c ON i.investor_code = c.inv_code
    LEFT JOIN trade_sums ts ON i.investor_code = ts.client_code
    LEFT JOIN deposit_sums ds ON i.investor_code = ds.inv_code
    LEFT JOIN opening_ledger ol ON i.investor_code = ol.investor_code
    WHERE (_search_term IS NULL OR _search_term = '' 
           OR i.investor_code ILIKE '%' || _search_term || '%'
           OR i.investor_name ILIKE '%' || _search_term || '%')
      AND (_account_type_filter IS NULL OR _account_type_filter = '' OR i.account_type = _account_type_filter)
      AND (_has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all'
           OR (_has_trades_filter = 'with_trades' AND ts.buy_sum IS NOT NULL AND (ts.buy_sum > 0 OR ts.sell_sum > 0))
           OR (_has_trades_filter = 'without_trades' AND (ts.buy_sum IS NULL OR (ts.buy_sum = 0 AND ts.sell_sum = 0))))
  ),
  calculated AS (
    SELECT
      bd.inv_code,
      bd.inv_name,
      bd.acc_type,
      bd.int_rate,
      bd.broker_comm,
      bd.opening_ledger,
      bd.acc_interest,
      bd.opening_ledger + bd.acc_interest AS adj_ledger,
      bd.g_buy,
      bd.g_sell,
      bd.g_buy * (1 + bd.broker_comm) AS n_buy,
      bd.g_sell * (1 - bd.broker_comm) AS n_sell,
      (bd.g_buy + bd.g_sell) * bd.broker_comm AS broker_amt,
      bd.tot_deposits,
      bd.tot_withdrawals,
      -- Calculate final balance: opening + deposits - withdrawals + net_sell - net_buy
      bd.opening_ledger + bd.tot_deposits - bd.tot_withdrawals 
        + (bd.g_sell * (1 - bd.broker_comm)) 
        - (bd.g_buy * (1 + bd.broker_comm)) AS fin_balance
    FROM base_data bd
  )
  SELECT
    c.inv_code::TEXT,
    c.inv_name::TEXT,
    c.acc_type::TEXT,
    c.int_rate,
    c.broker_comm,
    c.opening_ledger,
    c.acc_interest,
    c.adj_ledger,
    c.g_buy,
    c.g_sell,
    c.n_buy,
    c.n_sell,
    c.broker_amt,
    c.tot_deposits,
    c.tot_withdrawals,
    CASE WHEN c.fin_balance > 0 THEN c.fin_balance ELSE 0 END AS receivable,
    CASE WHEN c.fin_balance < 0 THEN ABS(c.fin_balance) ELSE 0 END AS payable,
    c.fin_balance,
    total
  FROM calculated c
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
        WHEN 'interest_rate' THEN c.int_rate
        WHEN 'brokerage_commission' THEN c.broker_comm
        WHEN 'ledger_balance' THEN c.opening_ledger
        WHEN 'accrued_interest' THEN c.acc_interest
        WHEN 'adjusted_ledger' THEN c.adj_ledger
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_amount' THEN c.broker_amt
        WHEN 'total_deposits' THEN c.tot_deposits
        WHEN 'total_withdrawals' THEN c.tot_withdrawals
        WHEN 'receivable' THEN CASE WHEN c.fin_balance > 0 THEN c.fin_balance ELSE 0 END
        WHEN 'payable' THEN CASE WHEN c.fin_balance < 0 THEN ABS(c.fin_balance) ELSE 0 END
        WHEN 'final_balance' THEN c.fin_balance
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'interest_rate' THEN c.int_rate
        WHEN 'brokerage_commission' THEN c.broker_comm
        WHEN 'ledger_balance' THEN c.opening_ledger
        WHEN 'accrued_interest' THEN c.acc_interest
        WHEN 'adjusted_ledger' THEN c.adj_ledger
        WHEN 'gross_buy' THEN c.g_buy
        WHEN 'gross_sell' THEN c.g_sell
        WHEN 'net_buy' THEN c.n_buy
        WHEN 'net_sell' THEN c.n_sell
        WHEN 'brokerage_amount' THEN c.broker_amt
        WHEN 'total_deposits' THEN c.tot_deposits
        WHEN 'total_withdrawals' THEN c.tot_withdrawals
        WHEN 'receivable' THEN CASE WHEN c.fin_balance > 0 THEN c.fin_balance ELSE 0 END
        WHEN 'payable' THEN CASE WHEN c.fin_balance < 0 THEN ABS(c.fin_balance) ELSE 0 END
        WHEN 'final_balance' THEN c.fin_balance
        ELSE NULL
      END
    END DESC NULLS LAST,
    c.inv_code ASC
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;