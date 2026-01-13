-- Drop existing versions of get_accounting_data
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text, text, text);

-- Create simplified get_accounting_data function
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search text DEFAULT NULL,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc',
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  opening_balance numeric,
  closing_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  rm_name text,
  department text,
  total_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(DISTINCT c.inv_code) INTO total
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT 
      COALESCE(SUM(CASE WHEN th.side = 'B' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'S' THEN th.value ELSE 0 END), 0) as sell_sum,
      MAX(th.department) as dept
    FROM trade_history th
    WHERE th.client_code = c.inv_code
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT 
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) as dep_sum,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) as wd_sum
    FROM deposits_withdrawals dw
    WHERE dw.investor_code = c.inv_code
      AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
  ) d ON true
  WHERE (_search IS NULL OR c.inv_code ILIKE '%' || _search || '%' OR c.investor_name ILIKE '%' || _search || '%')
    AND (COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0) + COALESCE(d.dep_sum, 0) + COALESCE(d.wd_sum, 0)) > 0;

  -- Return data with sorting (no pagination - return all)
  RETURN QUERY
  SELECT 
    c.inv_code::text as investor_code,
    c.investor_name::text as investor_name,
    c.ledger_balance as opening_balance,
    (c.ledger_balance + COALESCE(d.dep_sum, 0) - COALESCE(d.wd_sum, 0) + COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0)) as closing_balance,
    COALESCE(t.buy_sum, 0) as gross_buy,
    COALESCE(t.sell_sum, 0) as gross_sell,
    COALESCE(d.dep_sum, 0) as total_deposits,
    COALESCE(d.wd_sum, 0) as total_withdrawals,
    c.rm_name::text as rm_name,
    COALESCE(t.dept, '')::text as department,
    total as total_count
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT 
      COALESCE(SUM(CASE WHEN th.side = 'B' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'S' THEN th.value ELSE 0 END), 0) as sell_sum,
      MAX(th.department) as dept
    FROM trade_history th
    WHERE th.client_code = c.inv_code
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT 
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) as dep_sum,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) as wd_sum
    FROM deposits_withdrawals dw
    WHERE dw.investor_code = c.inv_code
      AND (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
  ) d ON true
  WHERE (_search IS NULL OR c.inv_code ILIKE '%' || _search || '%' OR c.investor_name ILIKE '%' || _search || '%')
    AND (COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0) + COALESCE(d.dep_sum, 0) + COALESCE(d.wd_sum, 0)) > 0
  ORDER BY
    CASE WHEN _sort_column = 'investor_code' AND _sort_direction = 'asc' THEN c.inv_code END ASC,
    CASE WHEN _sort_column = 'investor_code' AND _sort_direction = 'desc' THEN c.inv_code END DESC,
    CASE WHEN _sort_column = 'investor_name' AND _sort_direction = 'asc' THEN c.investor_name END ASC,
    CASE WHEN _sort_column = 'investor_name' AND _sort_direction = 'desc' THEN c.investor_name END DESC,
    c.inv_code ASC;

END;
$$;