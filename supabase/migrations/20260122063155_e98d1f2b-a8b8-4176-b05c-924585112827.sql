
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _search text DEFAULT ''::text,
  _from_trade_date text DEFAULT ''::text,
  _to_trade_date text DEFAULT ''::text,
  _from_tx_date text DEFAULT ''::text,
  _to_tx_date text DEFAULT ''::text,
  _account_type_filter text DEFAULT 'all'::text,
  _has_activity_filter text DEFAULT 'all'::text,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  acc_type text,
  rm_id text,
  rm_name text,
  department text,
  opening_balance numeric,
  total_deposit numeric,
  total_withdrawal numeric,
  total_buy numeric,
  total_sell numeric,
  total_brokerage numeric,
  accrued_interest numeric,
  closing_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_from_trade text;
  v_to_trade text;
BEGIN
  -- Set explicit timeout for complex query
  SET LOCAL statement_timeout = '60s';

  -- Convert transaction dates to trade date format if provided
  v_from_trade := CASE 
    WHEN _from_tx_date != '' THEN REPLACE(_from_tx_date, '-', '')
    WHEN _from_trade_date != '' THEN _from_trade_date
    ELSE ''
  END;
  
  v_to_trade := CASE 
    WHEN _to_tx_date != '' THEN REPLACE(_to_tx_date, '-', '')
    WHEN _to_trade_date != '' THEN _to_trade_date
    ELSE ''
  END;

  RETURN QUERY
  WITH base_clients AS (
    SELECT 
      c.investor_code,
      c.investor_name,
      COALESCE(c.acc_type, 'Cash') as acc_type,
      c.rm_id,
      c.rm_name,
      c.department
    FROM investors c
    WHERE 
      (_search = '' OR 
       c.investor_code ILIKE '%' || _search || '%' OR 
       c.investor_name ILIKE '%' || _search || '%' OR
       c.rm_id ILIKE '%' || _search || '%' OR
       c.rm_name ILIKE '%' || _search || '%')
      AND (_account_type_filter = 'all' OR LOWER(COALESCE(c.acc_type, 'Cash')) = LOWER(_account_type_filter))
  ),
  opening_balances AS (
    SELECT 
      b.investor_code,
      COALESCE(b.ledger_balance, 0) as opening_balance
    FROM balances_raw b
    WHERE b.as_of_date = (
      SELECT MAX(as_of_date) FROM balances_raw 
      WHERE as_of_date <= COALESCE(NULLIF(v_from_trade, ''), '99999999')
    )
  ),
  trade_sums AS (
    SELECT 
      t.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(t.side) = 'B' THEN t.amount ELSE 0 END), 0) as total_buy,
      COALESCE(SUM(CASE WHEN UPPER(t.side) = 'S' THEN t.amount ELSE 0 END), 0) as total_sell,
      COALESCE(SUM(t.commission), 0) as total_brokerage
    FROM trade_history t
    WHERE 
      (v_from_trade = '' OR t.trade_date >= v_from_trade)
      AND (v_to_trade = '' OR t.trade_date <= v_to_trade)
    GROUP BY t.client_code
  ),
  deposit_sums AS (
    SELECT 
      d.investor_code,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'Deposit' THEN d.amount ELSE 0 END), 0) as total_deposit,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'Withdrawal' THEN d.amount ELSE 0 END), 0) as total_withdrawal
    FROM deposits_withdrawals d
    WHERE 
      (v_from_trade = '' OR REPLACE(d.transaction_date, '-', '') >= v_from_trade)
      AND (v_to_trade = '' OR REPLACE(d.transaction_date, '-', '') <= v_to_trade)
    GROUP BY d.investor_code
  ),
  combined AS (
    SELECT 
      c.investor_code,
      c.investor_name,
      c.acc_type,
      c.rm_id,
      c.rm_name,
      c.department,
      COALESCE(ob.opening_balance, 0) as opening_balance,
      COALESCE(ds.total_deposit, 0) as total_deposit,
      COALESCE(ds.total_withdrawal, 0) as total_withdrawal,
      COALESCE(ts.total_buy, 0) as total_buy,
      COALESCE(ts.total_sell, 0) as total_sell,
      COALESCE(ts.total_brokerage, 0) as total_brokerage,
      0::numeric as accrued_interest,
      COALESCE(ob.opening_balance, 0) 
        + COALESCE(ds.total_deposit, 0) 
        - COALESCE(ds.total_withdrawal, 0) 
        + COALESCE(ts.total_sell, 0) 
        - COALESCE(ts.total_buy, 0) 
        - COALESCE(ts.total_brokerage, 0) as closing_balance,
      (COALESCE(ts.total_buy, 0) + COALESCE(ts.total_sell, 0) + COALESCE(ds.total_deposit, 0) + COALESCE(ds.total_withdrawal, 0)) > 0 as has_activity
    FROM base_clients c
    LEFT JOIN opening_balances ob ON c.investor_code = ob.investor_code
    LEFT JOIN trade_sums ts ON c.investor_code = ts.investor_code
    LEFT JOIN deposit_sums ds ON c.investor_code = ds.investor_code
  ),
  filtered AS (
    SELECT * FROM combined
    WHERE 
      _has_activity_filter = 'all' 
      OR (_has_activity_filter = 'with_activity' AND has_activity = true)
      OR (_has_activity_filter = 'no_activity' AND has_activity = false)
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM filtered
  )
  SELECT 
    f.investor_code,
    f.investor_name,
    f.acc_type,
    f.rm_id,
    f.rm_name,
    f.department,
    f.opening_balance,
    f.total_deposit,
    f.total_withdrawal,
    f.total_buy,
    f.total_sell,
    f.total_brokerage,
    f.accrued_interest,
    f.closing_balance,
    cnt.cnt as total_count
  FROM filtered f, counted cnt
  ORDER BY f.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$function$;
