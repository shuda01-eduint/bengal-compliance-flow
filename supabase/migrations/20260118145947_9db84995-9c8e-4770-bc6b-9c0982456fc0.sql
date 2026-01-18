-- Drop existing function first (has different return type)
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date,date,text,text,text,integer,integer);

-- Recreate with brokerage_amount column and COALESCE for commission lookup
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT 'all',
  _has_activity_filter text DEFAULT 'all',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm text,
  department text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  brokerage_amount numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH opening_bal AS (
    SELECT e.investor_code, e.ledger_balance as opening
    FROM eod_ledger_snapshots e
    WHERE e.eod_date = _opening_date
  ),
  day_trades AS (
    SELECT 
      t.client_code as inv_code,
      SUM(CASE WHEN t.side = 'B' THEN COALESCE(t.value, 0) ELSE 0 END) as buy_sum,
      SUM(CASE WHEN t.side = 'S' THEN COALESCE(t.value, 0) ELSE 0 END) as sell_sum,
      SUM(
        COALESCE(t.value, 0) * 
        CASE 
          WHEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) >= 0.1 
          THEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) / 100
          ELSE COALESCE(t.brokerage_commission, i.brokerage_commission, 0)
        END
      ) as commission_sum
    FROM trade_history t
    LEFT JOIN investors i ON t.client_code = i.investor_code
    WHERE t.trade_date::date > _opening_date AND t.trade_date::date <= _tx_date
    GROUP BY t.client_code
  ),
  day_deposits AS (
    SELECT 
      dw.investor_code as inv_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) as dep_sum,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) as wd_sum
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date > _opening_date AND dw.transaction_date <= _tx_date
    GROUP BY dw.investor_code
  ),
  all_codes AS (
    SELECT DISTINCT inv_code FROM (
      SELECT investor_code as inv_code FROM opening_bal
      UNION
      SELECT inv_code FROM day_trades
      UNION
      SELECT inv_code FROM day_deposits
    ) x
  ),
  combined AS (
    SELECT
      a.inv_code,
      COALESCE(i.investor_name, c.investor_name, '') as inv_name,
      COALESCE(i.account_type, '') as acc_type,
      COALESCE(
        (SELECT rm_name FROM investor_rm_assignments WHERE investor_code = a.inv_code LIMIT 1),
        c.rm_name,
        ''
      ) as rm_name,
      COALESCE(
        (SELECT department FROM investor_rm_assignments WHERE investor_code = a.inv_code LIMIT 1),
        ''
      ) as dept,
      COALESCE(ob.opening, 0) as open_bal,
      COALESCE(dd.dep_sum, 0) as dep_amt,
      COALESCE(dd.wd_sum, 0) as wd_amt,
      COALESCE(dt.buy_sum, 0) as buy_amt,
      COALESCE(dt.sell_sum, 0) as sell_amt,
      COALESCE(dt.commission_sum, 0) as comm_amt,
      COALESCE(ob.opening, 0) 
        + COALESCE(dd.dep_sum, 0) 
        - COALESCE(dd.wd_sum, 0) 
        - COALESCE(dt.buy_sum, 0) 
        + COALESCE(dt.sell_sum, 0)
        - COALESCE(dt.commission_sum, 0) as close_bal
    FROM all_codes a
    LEFT JOIN investors i ON a.inv_code = i.investor_code
    LEFT JOIN clients c ON a.inv_code = c.inv_code
    LEFT JOIN opening_bal ob ON a.inv_code = ob.investor_code
    LEFT JOIN day_trades dt ON a.inv_code = dt.inv_code
    LEFT JOIN day_deposits dd ON a.inv_code = dd.inv_code
  )
  SELECT
    c.inv_code,
    c.inv_name,
    c.acc_type,
    c.rm_name,
    c.dept,
    c.open_bal,
    c.dep_amt,
    c.wd_amt,
    c.buy_amt,
    c.sell_amt,
    c.comm_amt,
    c.close_bal
  FROM combined c
  WHERE 
    (_search = '' OR c.inv_code ILIKE '%' || _search || '%' OR c.inv_name ILIKE '%' || _search || '%')
    AND (_account_type_filter = 'all' OR c.acc_type = _account_type_filter)
    AND (_has_activity_filter = 'all' 
         OR (_has_activity_filter = 'with_activity' AND (c.buy_amt > 0 OR c.sell_amt > 0 OR c.dep_amt > 0 OR c.wd_amt > 0))
         OR (_has_activity_filter = 'no_activity' AND c.buy_amt = 0 AND c.sell_amt = 0 AND c.dep_amt = 0 AND c.wd_amt = 0))
  ORDER BY c.inv_code
  LIMIT _limit OFFSET _offset;
END;
$$;