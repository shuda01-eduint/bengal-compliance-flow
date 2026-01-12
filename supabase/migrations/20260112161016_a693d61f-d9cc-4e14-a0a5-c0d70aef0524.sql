-- Drop existing functions first
DROP FUNCTION IF EXISTS public.get_accounting_data;
DROP FUNCTION IF EXISTS public.get_accounting_summary;

-- Recreate get_accounting_data with proper with_activity filter
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term TEXT DEFAULT NULL,
  _account_type_filter TEXT DEFAULT NULL,
  _has_trades_filter TEXT DEFAULT NULL,
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
  _sort_column TEXT DEFAULT 'investor_code',
  _sort_direction TEXT DEFAULT 'asc',
  _page_size INT DEFAULT 50,
  _page_offset INT DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  account_type TEXT,
  brokerage_commission NUMERIC,
  interest_rate NUMERIC,
  ledger_balance NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  net_buy NUMERIC,
  net_sell NUMERIC,
  brokerage_amount NUMERIC,
  accrued_interest NUMERIC,
  adjusted_ledger NUMERIC,
  receivable NUMERIC,
  payable NUMERIC,
  final_balance NUMERIC,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_rows BIGINT;
BEGIN
  -- Get total count first
  SELECT COUNT(DISTINCT i.investor_code) INTO total_rows
  FROM investors i
  WHERE (
    _search_term IS NULL 
    OR i.investor_code ILIKE '%' || _search_term || '%'
    OR i.investor_name ILIKE '%' || _search_term || '%'
  )
  AND (
    _account_type_filter IS NULL 
    OR _account_type_filter = 'all'
    OR i.account_type = _account_type_filter
  )
  AND (
    _has_trades_filter IS NULL 
    OR _has_trades_filter = 'all'
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
    OR (_has_trades_filter = 'with_activity' AND (
      EXISTS (
        SELECT 1 FROM trade_history th2 
        WHERE th2.client_code = i.investor_code
        AND (_from_trade_date IS NULL OR th2.trade_date >= _from_trade_date::date)
        AND (_to_trade_date IS NULL OR th2.trade_date <= _to_trade_date::date)
      )
      OR EXISTS (
        SELECT 1 FROM deposits_withdrawals dw2
        WHERE dw2.investor_code = i.investor_code
        AND (_from_tx_date IS NULL OR dw2.transaction_date >= _from_tx_date::date)
        AND (_to_tx_date IS NULL OR dw2.transaction_date <= _to_tx_date::date)
      )
    ))
  );

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'B' THEN COALESCE(th.value, 0) ELSE 0 END) as buy_sum,
      SUM(CASE WHEN th.side = 'S' THEN COALESCE(th.value, 0) ELSE 0 END) as sell_sum
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date::date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date::date)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  client_data AS (
    SELECT DISTINCT ON (c.inv_code)
      c.inv_code,
      c.ledger_balance as client_ledger,
      c.accrued_interest as client_interest
    FROM clients c
    ORDER BY c.inv_code, c.updated_at DESC
  )
  SELECT 
    i.investor_code,
    i.investor_name,
    COALESCE(i.account_type, 'Regular')::TEXT as account_type,
    COALESCE(i.brokerage_commission, 0.25)::NUMERIC as brokerage_commission,
    COALESCE(i.interest_rate, 0)::NUMERIC as interest_rate,
    COALESCE(cd.client_ledger, 0)::NUMERIC as ledger_balance,
    COALESCE(ts.buy_sum, 0)::NUMERIC as gross_buy,
    COALESCE(ts.sell_sum, 0)::NUMERIC as gross_sell,
    (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100))::NUMERIC as net_buy,
    (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100))::NUMERIC as net_sell,
    ((COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0.25) / 100)::NUMERIC as brokerage_amount,
    COALESCE(cd.client_interest, 0)::NUMERIC as accrued_interest,
    (COALESCE(cd.client_ledger, 0) + COALESCE(ds.deposits, 0) - COALESCE(ds.withdrawals, 0))::NUMERIC as adjusted_ledger,
    GREATEST(0, (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)))::NUMERIC as receivable,
    GREATEST(0, (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)))::NUMERIC as payable,
    (COALESCE(cd.client_ledger, 0) + COALESCE(ds.deposits, 0) - COALESCE(ds.withdrawals, 0) + 
     (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - 
     (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)))::NUMERIC as final_balance,
    COALESCE(ds.deposits, 0)::NUMERIC as total_deposits,
    COALESCE(ds.withdrawals, 0)::NUMERIC as total_withdrawals,
    total_rows as total_count
  FROM investors i
  LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
  LEFT JOIN deposit_sums ds ON ds.investor_code = i.investor_code
  LEFT JOIN client_data cd ON cd.inv_code = i.investor_code
  WHERE (
    _search_term IS NULL 
    OR i.investor_code ILIKE '%' || _search_term || '%'
    OR i.investor_name ILIKE '%' || _search_term || '%'
  )
  AND (
    _account_type_filter IS NULL 
    OR _account_type_filter = 'all'
    OR i.account_type = _account_type_filter
  )
  AND (
    _has_trades_filter IS NULL 
    OR _has_trades_filter = 'all'
    OR (_has_trades_filter = 'with_trades' AND ts.client_code IS NOT NULL)
    OR (_has_trades_filter = 'without_trades' AND ts.client_code IS NULL)
    OR (_has_trades_filter = 'with_activity' AND (ts.client_code IS NOT NULL OR ds.investor_code IS NOT NULL))
  )
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN i.investor_code
        WHEN 'investor_name' THEN i.investor_name
        WHEN 'account_type' THEN COALESCE(i.account_type, 'Regular')
        ELSE i.investor_code
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN i.investor_code
        WHEN 'investor_name' THEN i.investor_name
        WHEN 'account_type' THEN COALESCE(i.account_type, 'Regular')
        ELSE i.investor_code
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN COALESCE(cd.client_ledger, 0)
        WHEN 'gross_buy' THEN COALESCE(ts.buy_sum, 0)
        WHEN 'gross_sell' THEN COALESCE(ts.sell_sum, 0)
        WHEN 'brokerage_amount' THEN (COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0.25) / 100
        WHEN 'receivable' THEN GREATEST(0, (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)))
        WHEN 'payable' THEN GREATEST(0, (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)))
        WHEN 'final_balance' THEN COALESCE(cd.client_ledger, 0) + COALESCE(ds.deposits, 0) - COALESCE(ds.withdrawals, 0) + (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100))
        WHEN 'total_deposits' THEN COALESCE(ds.deposits, 0)
        WHEN 'total_withdrawals' THEN COALESCE(ds.withdrawals, 0)
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN COALESCE(cd.client_ledger, 0)
        WHEN 'gross_buy' THEN COALESCE(ts.buy_sum, 0)
        WHEN 'gross_sell' THEN COALESCE(ts.sell_sum, 0)
        WHEN 'brokerage_amount' THEN (COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0.25) / 100
        WHEN 'receivable' THEN GREATEST(0, (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)))
        WHEN 'payable' THEN GREATEST(0, (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)))
        WHEN 'final_balance' THEN COALESCE(cd.client_ledger, 0) + COALESCE(ds.deposits, 0) - COALESCE(ds.withdrawals, 0) + (COALESCE(ts.sell_sum, 0) * (1 - COALESCE(i.brokerage_commission, 0.25) / 100)) - (COALESCE(ts.buy_sum, 0) * (1 + COALESCE(i.brokerage_commission, 0.25) / 100))
        WHEN 'total_deposits' THEN COALESCE(ds.deposits, 0)
        WHEN 'total_withdrawals' THEN COALESCE(ds.withdrawals, 0)
        ELSE NULL
      END
    END DESC NULLS LAST
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;

-- Recreate get_accounting_summary with proper with_activity filter
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  _account_type_filter TEXT DEFAULT NULL,
  _has_trades_filter TEXT DEFAULT NULL,
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_accounts BIGINT,
  margin_accounts BIGINT,
  non_margin_accounts BIGINT,
  margin_percentage NUMERIC,
  total_buy NUMERIC,
  total_sell NUMERIC,
  total_trade_value NUMERIC,
  total_commission NUMERIC,
  total_receivable NUMERIC,
  total_payable NUMERIC,
  total_accrued_interest NUMERIC,
  total_margin_loan NUMERIC,
  margin_buy NUMERIC,
  margin_sell NUMERIC,
  margin_receivable NUMERIC,
  margin_payable NUMERIC,
  non_margin_buy NUMERIC,
  non_margin_sell NUMERIC,
  non_margin_receivable NUMERIC,
  non_margin_payable NUMERIC
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
      SUM(CASE WHEN th.side = 'B' THEN COALESCE(th.value, 0) ELSE 0 END) as buy_sum,
      SUM(CASE WHEN th.side = 'S' THEN COALESCE(th.value, 0) ELSE 0 END) as sell_sum
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date::date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date::date)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  client_data AS (
    SELECT DISTINCT ON (c.inv_code)
      c.inv_code,
      c.ledger_balance as client_ledger,
      c.accrued_interest as client_interest
    FROM clients c
    ORDER BY c.inv_code, c.updated_at DESC
  ),
  filtered_investors AS (
    SELECT 
      i.investor_code,
      i.account_type,
      COALESCE(i.brokerage_commission, 0.25) as commission_rate,
      COALESCE(ts.buy_sum, 0) as gross_buy,
      COALESCE(ts.sell_sum, 0) as gross_sell,
      COALESCE(cd.client_interest, 0) as accrued_interest,
      COALESCE(cd.client_ledger, 0) as ledger_balance
    FROM investors i
    LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
    LEFT JOIN deposit_sums ds ON ds.investor_code = i.investor_code
    LEFT JOIN client_data cd ON cd.inv_code = i.investor_code
    WHERE (
      _account_type_filter IS NULL 
      OR _account_type_filter = 'all'
      OR i.account_type = _account_type_filter
    )
    AND (
      _has_trades_filter IS NULL 
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_trades' AND ts.client_code IS NOT NULL)
      OR (_has_trades_filter = 'without_trades' AND ts.client_code IS NULL)
      OR (_has_trades_filter = 'with_activity' AND (ts.client_code IS NOT NULL OR ds.investor_code IS NOT NULL))
    )
  )
  SELECT
    COUNT(*)::BIGINT as total_accounts,
    COUNT(*) FILTER (WHERE fi.account_type = 'Margin')::BIGINT as margin_accounts,
    COUNT(*) FILTER (WHERE fi.account_type IS NULL OR fi.account_type != 'Margin')::BIGINT as non_margin_accounts,
    CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE fi.account_type = 'Margin')::NUMERIC / COUNT(*)::NUMERIC * 100) ELSE 0 END as margin_percentage,
    SUM(fi.gross_buy)::NUMERIC as total_buy,
    SUM(fi.gross_sell)::NUMERIC as total_sell,
    (SUM(fi.gross_buy) + SUM(fi.gross_sell))::NUMERIC as total_trade_value,
    SUM((fi.gross_buy + fi.gross_sell) * fi.commission_rate / 100)::NUMERIC as total_commission,
    SUM(GREATEST(0, (fi.gross_sell * (1 - fi.commission_rate / 100)) - (fi.gross_buy * (1 + fi.commission_rate / 100))))::NUMERIC as total_receivable,
    SUM(GREATEST(0, (fi.gross_buy * (1 + fi.commission_rate / 100)) - (fi.gross_sell * (1 - fi.commission_rate / 100))))::NUMERIC as total_payable,
    SUM(fi.accrued_interest)::NUMERIC as total_accrued_interest,
    SUM(CASE WHEN fi.account_type = 'Margin' AND fi.ledger_balance < 0 THEN ABS(fi.ledger_balance) ELSE 0 END)::NUMERIC as total_margin_loan,
    SUM(CASE WHEN fi.account_type = 'Margin' THEN fi.gross_buy ELSE 0 END)::NUMERIC as margin_buy,
    SUM(CASE WHEN fi.account_type = 'Margin' THEN fi.gross_sell ELSE 0 END)::NUMERIC as margin_sell,
    SUM(CASE WHEN fi.account_type = 'Margin' THEN GREATEST(0, (fi.gross_sell * (1 - fi.commission_rate / 100)) - (fi.gross_buy * (1 + fi.commission_rate / 100))) ELSE 0 END)::NUMERIC as margin_receivable,
    SUM(CASE WHEN fi.account_type = 'Margin' THEN GREATEST(0, (fi.gross_buy * (1 + fi.commission_rate / 100)) - (fi.gross_sell * (1 - fi.commission_rate / 100))) ELSE 0 END)::NUMERIC as margin_payable,
    SUM(CASE WHEN fi.account_type IS NULL OR fi.account_type != 'Margin' THEN fi.gross_buy ELSE 0 END)::NUMERIC as non_margin_buy,
    SUM(CASE WHEN fi.account_type IS NULL OR fi.account_type != 'Margin' THEN fi.gross_sell ELSE 0 END)::NUMERIC as non_margin_sell,
    SUM(CASE WHEN fi.account_type IS NULL OR fi.account_type != 'Margin' THEN GREATEST(0, (fi.gross_sell * (1 - fi.commission_rate / 100)) - (fi.gross_buy * (1 + fi.commission_rate / 100))) ELSE 0 END)::NUMERIC as non_margin_receivable,
    SUM(CASE WHEN fi.account_type IS NULL OR fi.account_type != 'Margin' THEN GREATEST(0, (fi.gross_buy * (1 + fi.commission_rate / 100)) - (fi.gross_sell * (1 - fi.commission_rate / 100))) ELSE 0 END)::NUMERIC as non_margin_payable
  FROM filtered_investors fi;
END;
$$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';