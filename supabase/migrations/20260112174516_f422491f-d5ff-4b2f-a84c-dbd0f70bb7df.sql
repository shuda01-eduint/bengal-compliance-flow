-- Drop and recreate get_accounting_data with correct ledger balance calculation
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  ledger_balance numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  adjusted_ledger numeric,
  accrued_interest numeric,
  receivable numeric,
  payable numeric,
  brokerage_amount numeric,
  final_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  total_records bigint;
  effective_from_date date;
BEGIN
  -- Determine the effective from date for EOD snapshot lookup
  IF _from_trade_date IS NOT NULL THEN
    effective_from_date := _from_trade_date::date - INTERVAL '1 day';
  ELSE
    effective_from_date := CURRENT_DATE - INTERVAL '1 day';
  END IF;

  -- Get total count first
  SELECT COUNT(DISTINCT c.inv_code) INTO total_records
  FROM clients c
  LEFT JOIN investors i ON c.inv_code = i.investor_code
  LEFT JOIN (
    SELECT client_code, SUM(value) as total_value
    FROM trade_history
    WHERE (_from_trade_date IS NULL OR trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR trade_date <= _to_trade_date)
    GROUP BY client_code
  ) t ON c.inv_code = t.client_code
  WHERE (_search_term IS NULL OR _search_term = '' OR 
         c.inv_code ILIKE '%' || _search_term || '%' OR 
         c.investor_name ILIKE '%' || _search_term || '%')
    AND (_account_type_filter IS NULL OR _account_type_filter = '' OR _account_type_filter = 'all' OR i.account_type = _account_type_filter)
    AND (_has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all' OR 
         (_has_trades_filter = 'yes' AND t.total_value IS NOT NULL AND t.total_value > 0) OR
         (_has_trades_filter = 'no' AND (t.total_value IS NULL OR t.total_value = 0)));

  RETURN QUERY
  WITH eod_snapshots AS (
    -- Get the most recent EOD snapshot for each investor before the effective date
    SELECT DISTINCT ON (e.investor_code)
      e.investor_code,
      e.ledger_balance as eod_ledger_balance
    FROM eod_ledger_snapshots e
    WHERE e.eod_date <= effective_from_date
    ORDER BY e.investor_code, e.eod_date DESC
  ),
  trade_sums AS (
    SELECT 
      client_code,
      SUM(CASE WHEN side = 'B' OR side = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as buy_sum,
      SUM(CASE WHEN side = 'S' OR side = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as sell_sum
    FROM trade_history
    WHERE (_from_trade_date IS NULL OR trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR trade_date <= _to_trade_date)
    GROUP BY client_code
  ),
  deposit_sums AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    GROUP BY dw.investor_code
  ),
  base_data AS (
    SELECT 
      c.inv_code,
      c.investor_name as inv_name,
      COALESCE(i.account_type, 'Cash') as acc_type,
      COALESCE(i.interest_rate, 0) as int_rate,
      COALESCE(i.brokerage_commission, 0.004) as broker_comm,
      -- Use EOD snapshot if available, otherwise fall back to clients.ledger_balance
      COALESCE(e.eod_ledger_balance, c.ledger_balance) as opening_ledger,
      COALESCE(d.deposits, 0) as tot_deposits,
      COALESCE(d.withdrawals, 0) as tot_withdrawals,
      COALESCE(t.buy_sum, 0) as g_buy,
      COALESCE(t.sell_sum, 0) as g_sell
    FROM clients c
    LEFT JOIN investors i ON c.inv_code = i.investor_code
    LEFT JOIN eod_snapshots e ON c.inv_code = e.investor_code
    LEFT JOIN trade_sums t ON c.inv_code = t.client_code
    LEFT JOIN deposit_sums d ON c.inv_code = d.investor_code
    WHERE (_search_term IS NULL OR _search_term = '' OR 
           c.inv_code ILIKE '%' || _search_term || '%' OR 
           c.investor_name ILIKE '%' || _search_term || '%')
      AND (_account_type_filter IS NULL OR _account_type_filter = '' OR _account_type_filter = 'all' OR i.account_type = _account_type_filter)
      AND (_has_trades_filter IS NULL OR _has_trades_filter = '' OR _has_trades_filter = 'all' OR 
           (_has_trades_filter = 'yes' AND t.buy_sum IS NOT NULL AND (t.buy_sum > 0 OR t.sell_sum > 0)) OR
           (_has_trades_filter = 'no' AND (t.buy_sum IS NULL OR (t.buy_sum = 0 AND t.sell_sum = 0))))
  ),
  calculated_data AS (
    SELECT 
      b.inv_code,
      b.inv_name,
      b.acc_type,
      b.int_rate,
      b.broker_comm,
      b.opening_ledger,
      b.tot_deposits,
      b.tot_withdrawals,
      b.g_buy,
      b.g_sell,
      -- Net values after commission
      b.g_buy * (1 + b.broker_comm) as n_buy,
      b.g_sell * (1 - b.broker_comm) as n_sell,
      -- Brokerage amount on total turnover
      (b.g_buy + b.g_sell) * b.broker_comm as broker_amt,
      -- Adjusted ledger: opening + deposits - withdrawals
      b.opening_ledger + b.tot_deposits - b.tot_withdrawals as adj_ledger,
      -- Accrued interest calculation for margin accounts
      CASE 
        WHEN b.acc_type = 'Margin' AND b.opening_ledger < 0 
        THEN ABS(b.opening_ledger) * b.int_rate / 365
        ELSE 0 
      END as acc_interest
    FROM base_data b
  ),
  final_data AS (
    SELECT 
      cd.inv_code,
      cd.inv_name,
      cd.acc_type,
      cd.int_rate,
      cd.broker_comm,
      cd.opening_ledger,
      cd.tot_deposits,
      cd.tot_withdrawals,
      cd.g_buy,
      cd.g_sell,
      cd.n_buy,
      cd.n_sell,
      cd.adj_ledger,
      cd.acc_interest,
      cd.broker_amt,
      -- Receivable: what client owes us (buys + commission on buys)
      cd.g_buy * (1 + cd.broker_comm) as recv,
      -- Payable: what we owe client (sells - commission on sells)
      cd.g_sell * (1 - cd.broker_comm) as pay,
      -- Final balance: opening + deposits - withdrawals + sells - buys - total commission
      cd.opening_ledger + cd.tot_deposits - cd.tot_withdrawals + cd.g_sell - cd.g_buy - cd.broker_amt as fin_balance
    FROM calculated_data cd
  )
  SELECT 
    f.inv_code::text,
    f.inv_name::text,
    f.acc_type::text,
    f.int_rate::numeric,
    f.broker_comm::numeric,
    f.opening_ledger::numeric,
    f.tot_deposits::numeric,
    f.tot_withdrawals::numeric,
    f.g_buy::numeric,
    f.g_sell::numeric,
    f.n_buy::numeric,
    f.n_sell::numeric,
    f.adj_ledger::numeric,
    f.acc_interest::numeric,
    f.recv::numeric,
    f.pay::numeric,
    f.broker_amt::numeric,
    f.fin_balance::numeric,
    total_records
  FROM final_data f
  ORDER BY
    CASE WHEN _sort_column = 'investor_code' AND _sort_direction = 'asc' THEN f.inv_code END ASC NULLS LAST,
    CASE WHEN _sort_column = 'investor_code' AND _sort_direction = 'desc' THEN f.inv_code END DESC NULLS LAST,
    CASE WHEN _sort_column = 'investor_name' AND _sort_direction = 'asc' THEN f.inv_name END ASC NULLS LAST,
    CASE WHEN _sort_column = 'investor_name' AND _sort_direction = 'desc' THEN f.inv_name END DESC NULLS LAST,
    CASE WHEN _sort_column = 'account_type' AND _sort_direction = 'asc' THEN f.acc_type END ASC NULLS LAST,
    CASE WHEN _sort_column = 'account_type' AND _sort_direction = 'desc' THEN f.acc_type END DESC NULLS LAST,
    CASE WHEN _sort_column = 'interest_rate' AND _sort_direction = 'asc' THEN f.int_rate END ASC NULLS LAST,
    CASE WHEN _sort_column = 'interest_rate' AND _sort_direction = 'desc' THEN f.int_rate END DESC NULLS LAST,
    CASE WHEN _sort_column = 'brokerage_commission' AND _sort_direction = 'asc' THEN f.broker_comm END ASC NULLS LAST,
    CASE WHEN _sort_column = 'brokerage_commission' AND _sort_direction = 'desc' THEN f.broker_comm END DESC NULLS LAST,
    CASE WHEN _sort_column = 'ledger_balance' AND _sort_direction = 'asc' THEN f.opening_ledger END ASC NULLS LAST,
    CASE WHEN _sort_column = 'ledger_balance' AND _sort_direction = 'desc' THEN f.opening_ledger END DESC NULLS LAST,
    CASE WHEN _sort_column = 'total_deposits' AND _sort_direction = 'asc' THEN f.tot_deposits END ASC NULLS LAST,
    CASE WHEN _sort_column = 'total_deposits' AND _sort_direction = 'desc' THEN f.tot_deposits END DESC NULLS LAST,
    CASE WHEN _sort_column = 'total_withdrawals' AND _sort_direction = 'asc' THEN f.tot_withdrawals END ASC NULLS LAST,
    CASE WHEN _sort_column = 'total_withdrawals' AND _sort_direction = 'desc' THEN f.tot_withdrawals END DESC NULLS LAST,
    CASE WHEN _sort_column = 'gross_buy' AND _sort_direction = 'asc' THEN f.g_buy END ASC NULLS LAST,
    CASE WHEN _sort_column = 'gross_buy' AND _sort_direction = 'desc' THEN f.g_buy END DESC NULLS LAST,
    CASE WHEN _sort_column = 'gross_sell' AND _sort_direction = 'asc' THEN f.g_sell END ASC NULLS LAST,
    CASE WHEN _sort_column = 'gross_sell' AND _sort_direction = 'desc' THEN f.g_sell END DESC NULLS LAST,
    CASE WHEN _sort_column = 'net_buy' AND _sort_direction = 'asc' THEN f.n_buy END ASC NULLS LAST,
    CASE WHEN _sort_column = 'net_buy' AND _sort_direction = 'desc' THEN f.n_buy END DESC NULLS LAST,
    CASE WHEN _sort_column = 'net_sell' AND _sort_direction = 'asc' THEN f.n_sell END ASC NULLS LAST,
    CASE WHEN _sort_column = 'net_sell' AND _sort_direction = 'desc' THEN f.n_sell END DESC NULLS LAST,
    CASE WHEN _sort_column = 'adjusted_ledger' AND _sort_direction = 'asc' THEN f.adj_ledger END ASC NULLS LAST,
    CASE WHEN _sort_column = 'adjusted_ledger' AND _sort_direction = 'desc' THEN f.adj_ledger END DESC NULLS LAST,
    CASE WHEN _sort_column = 'accrued_interest' AND _sort_direction = 'asc' THEN f.acc_interest END ASC NULLS LAST,
    CASE WHEN _sort_column = 'accrued_interest' AND _sort_direction = 'desc' THEN f.acc_interest END DESC NULLS LAST,
    CASE WHEN _sort_column = 'receivable' AND _sort_direction = 'asc' THEN f.recv END ASC NULLS LAST,
    CASE WHEN _sort_column = 'receivable' AND _sort_direction = 'desc' THEN f.recv END DESC NULLS LAST,
    CASE WHEN _sort_column = 'payable' AND _sort_direction = 'asc' THEN f.pay END ASC NULLS LAST,
    CASE WHEN _sort_column = 'payable' AND _sort_direction = 'desc' THEN f.pay END DESC NULLS LAST,
    CASE WHEN _sort_column = 'brokerage_amount' AND _sort_direction = 'asc' THEN f.broker_amt END ASC NULLS LAST,
    CASE WHEN _sort_column = 'brokerage_amount' AND _sort_direction = 'desc' THEN f.broker_amt END DESC NULLS LAST,
    CASE WHEN _sort_column = 'final_balance' AND _sort_direction = 'asc' THEN f.fin_balance END ASC NULLS LAST,
    CASE WHEN _sort_column = 'final_balance' AND _sort_direction = 'desc' THEN f.fin_balance END DESC NULLS LAST,
    f.inv_code ASC
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;