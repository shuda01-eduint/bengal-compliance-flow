
-- Fix get_accounting_data function: replace buy_sell with side, total_cost with value
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT ''::text,
  _from_trade_date date DEFAULT NULL::date,
  _to_trade_date date DEFAULT NULL::date,
  _from_tx_date date DEFAULT NULL::date,
  _to_tx_date date DEFAULT NULL::date,
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0,
  _account_type_filter text DEFAULT 'all'::text,
  _has_trades_filter boolean DEFAULT true,
  _sort_column text DEFAULT 'investor_code'::text,
  _sort_direction text DEFAULT 'asc'::text
)
RETURNS TABLE(
  investor_id uuid,
  investor_code text,
  investor_name text,
  account_type text,
  rm_code text,
  net_buy numeric,
  net_sell numeric,
  gross_buy numeric,
  gross_sell numeric,
  deposits numeric,
  withdrawals numeric,
  opening_balance numeric,
  closing_balance numeric,
  trade_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH investor_trades AS (
    SELECT 
      i.id as inv_id,
      COALESCE(SUM(CASE WHEN th.side IN ('BUY', 'B') THEN th.value ELSE 0 END), 0) as net_buy,
      COALESCE(SUM(CASE WHEN th.side IN ('SELL', 'S') THEN th.value ELSE 0 END), 0) as net_sell,
      COALESCE(SUM(CASE WHEN th.side IN ('BUY', 'B') THEN th.value ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN th.side IN ('SELL', 'S') THEN th.value ELSE 0 END), 0) as gross_sell,
      COUNT(th.id) as trade_count
    FROM investors i
    LEFT JOIN trade_history th ON th.investor_code = i.investor_code
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
    GROUP BY i.id
  ),
  investor_transactions AS (
    SELECT 
      i.id as inv_id,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM investors i
    LEFT JOIN deposits_withdrawals dw ON dw.investor_code = i.investor_code
      AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
    GROUP BY i.id
  ),
  combined AS (
    SELECT 
      i.id,
      i.investor_code,
      i.name,
      i.account_type,
      i.rm_code,
      COALESCE(it.net_buy, 0) as net_buy,
      COALESCE(it.net_sell, 0) as net_sell,
      COALESCE(it.gross_buy, 0) as gross_buy,
      COALESCE(it.gross_sell, 0) as gross_sell,
      COALESCE(itx.deposits, 0) as deposits,
      COALESCE(itx.withdrawals, 0) as withdrawals,
      COALESCE(i.opening_balance, 0) as opening_balance,
      COALESCE(i.closing_balance, 0) as closing_balance,
      COALESCE(it.trade_count, 0) as trade_count
    FROM investors i
    LEFT JOIN investor_trades it ON it.inv_id = i.id
    LEFT JOIN investor_transactions itx ON itx.inv_id = i.id
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
      AND (NOT _has_trades_filter OR COALESCE(it.trade_count, 0) > 0 OR COALESCE(itx.deposits, 0) > 0 OR COALESCE(itx.withdrawals, 0) > 0)
  ),
  total AS (
    SELECT COUNT(*) as cnt FROM combined
  )
  SELECT 
    c.id as investor_id,
    c.investor_code,
    c.name as investor_name,
    c.account_type,
    c.rm_code,
    c.net_buy,
    c.net_sell,
    c.gross_buy,
    c.gross_sell,
    c.deposits,
    c.withdrawals,
    c.opening_balance,
    c.closing_balance,
    c.trade_count,
    t.cnt as total_count
  FROM combined c, total t
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.investor_code
        WHEN 'investor_name' THEN c.name
        WHEN 'account_type' THEN c.account_type
        WHEN 'rm_code' THEN c.rm_code
        ELSE c.investor_code
      END
    END ASC,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.investor_code
        WHEN 'investor_name' THEN c.name
        WHEN 'account_type' THEN c.account_type
        WHEN 'rm_code' THEN c.rm_code
        ELSE c.investor_code
      END
    END DESC,
    CASE WHEN _sort_direction = 'asc' AND _sort_column IN ('net_buy', 'net_sell', 'gross_buy', 'gross_sell', 'deposits', 'withdrawals', 'opening_balance', 'closing_balance', 'trade_count') THEN
      CASE _sort_column
        WHEN 'net_buy' THEN c.net_buy
        WHEN 'net_sell' THEN c.net_sell
        WHEN 'gross_buy' THEN c.gross_buy
        WHEN 'gross_sell' THEN c.gross_sell
        WHEN 'deposits' THEN c.deposits
        WHEN 'withdrawals' THEN c.withdrawals
        WHEN 'opening_balance' THEN c.opening_balance
        WHEN 'closing_balance' THEN c.closing_balance
        WHEN 'trade_count' THEN c.trade_count::numeric
        ELSE 0
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' AND _sort_column IN ('net_buy', 'net_sell', 'gross_buy', 'gross_sell', 'deposits', 'withdrawals', 'opening_balance', 'closing_balance', 'trade_count') THEN
      CASE _sort_column
        WHEN 'net_buy' THEN c.net_buy
        WHEN 'net_sell' THEN c.net_sell
        WHEN 'gross_buy' THEN c.gross_buy
        WHEN 'gross_sell' THEN c.gross_sell
        WHEN 'deposits' THEN c.deposits
        WHEN 'withdrawals' THEN c.withdrawals
        WHEN 'opening_balance' THEN c.opening_balance
        WHEN 'closing_balance' THEN c.closing_balance
        WHEN 'trade_count' THEN c.trade_count::numeric
        ELSE 0
      END
    END DESC NULLS LAST
  LIMIT _page_size OFFSET _page_offset;
END;
$$;

-- Fix get_accounting_summary function
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  _search_term text DEFAULT ''::text,
  _from_trade_date date DEFAULT NULL::date,
  _to_trade_date date DEFAULT NULL::date,
  _from_tx_date date DEFAULT NULL::date,
  _to_tx_date date DEFAULT NULL::date,
  _account_type_filter text DEFAULT 'all'::text,
  _has_trades_filter boolean DEFAULT true
)
RETURNS TABLE(
  total_investors bigint,
  total_net_buy numeric,
  total_net_sell numeric,
  total_gross_buy numeric,
  total_gross_sell numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  total_trades bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH investor_trades AS (
    SELECT 
      i.id as inv_id,
      COALESCE(SUM(CASE WHEN th.side IN ('BUY', 'B') THEN th.value ELSE 0 END), 0) as net_buy,
      COALESCE(SUM(CASE WHEN th.side IN ('SELL', 'S') THEN th.value ELSE 0 END), 0) as net_sell,
      COALESCE(SUM(CASE WHEN th.side IN ('BUY', 'B') THEN th.value ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN th.side IN ('SELL', 'S') THEN th.value ELSE 0 END), 0) as gross_sell,
      COUNT(th.id) as trade_count
    FROM investors i
    LEFT JOIN trade_history th ON th.investor_code = i.investor_code
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
    GROUP BY i.id
  ),
  investor_transactions AS (
    SELECT 
      i.id as inv_id,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM investors i
    LEFT JOIN deposits_withdrawals dw ON dw.investor_code = i.investor_code
      AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
    GROUP BY i.id
  ),
  combined AS (
    SELECT 
      i.id,
      COALESCE(it.net_buy, 0) as net_buy,
      COALESCE(it.net_sell, 0) as net_sell,
      COALESCE(it.gross_buy, 0) as gross_buy,
      COALESCE(it.gross_sell, 0) as gross_sell,
      COALESCE(itx.deposits, 0) as deposits,
      COALESCE(itx.withdrawals, 0) as withdrawals,
      COALESCE(it.trade_count, 0) as trade_count
    FROM investors i
    LEFT JOIN investor_trades it ON it.inv_id = i.id
    LEFT JOIN investor_transactions itx ON itx.inv_id = i.id
    WHERE (_account_type_filter = 'all' OR UPPER(i.account_type) = UPPER(_account_type_filter))
      AND (_search_term = '' OR i.investor_code ILIKE '%' || _search_term || '%' OR i.name ILIKE '%' || _search_term || '%')
      AND (NOT _has_trades_filter OR COALESCE(it.trade_count, 0) > 0 OR COALESCE(itx.deposits, 0) > 0 OR COALESCE(itx.withdrawals, 0) > 0)
  )
  SELECT 
    COUNT(*)::bigint as total_investors,
    SUM(c.net_buy) as total_net_buy,
    SUM(c.net_sell) as total_net_sell,
    SUM(c.gross_buy) as total_gross_buy,
    SUM(c.gross_sell) as total_gross_sell,
    SUM(c.deposits) as total_deposits,
    SUM(c.withdrawals) as total_withdrawals,
    SUM(c.trade_count)::bigint as total_trades
  FROM combined c;
END;
$$;
