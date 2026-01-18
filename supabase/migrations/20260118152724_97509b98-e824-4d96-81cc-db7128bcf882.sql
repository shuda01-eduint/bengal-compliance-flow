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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH opening_bal AS (
    SELECT e.investor_code AS inv_code, e.ledger_balance AS opening
    FROM eod_ledger_snapshots e
    WHERE e.eod_date = _opening_date
  ),
  day_trades AS (
    SELECT 
      t.client_code AS inv_code,
      SUM(CASE WHEN t.side = 'BUY' THEN COALESCE(t.value, 0) ELSE 0 END) AS buy_sum,
      SUM(CASE WHEN t.side = 'SELL' THEN COALESCE(t.value, 0) ELSE 0 END) AS sell_sum,
      SUM(
        COALESCE(t.value, 0) * 
        CASE 
          WHEN COALESCE(t.brokerage_commission, inv.brokerage_commission, 0) >= 0.1 
          THEN COALESCE(t.brokerage_commission, inv.brokerage_commission, 0) / 100
          ELSE COALESCE(t.brokerage_commission, inv.brokerage_commission, 0)
        END
      ) AS commission_sum
    FROM trade_history t
    LEFT JOIN investors inv ON t.client_code = inv.investor_code
    WHERE t.trade_date ~ '^[0-9]{8}$'
      AND to_date(t.trade_date, 'YYYYMMDD') > _opening_date 
      AND to_date(t.trade_date, 'YYYYMMDD') <= _tx_date
    GROUP BY t.client_code
  ),
  day_deposits AS (
    SELECT 
      dw.investor_code AS inv_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) AS dep_sum,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) AS wd_sum
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date > _opening_date AND dw.transaction_date <= _tx_date
    GROUP BY dw.investor_code
  ),
  all_codes AS (
    SELECT DISTINCT x.inv_code FROM (
      SELECT ob.inv_code FROM opening_bal ob
      UNION
      SELECT dt.inv_code FROM day_trades dt
      UNION
      SELECT dd.inv_code FROM day_deposits dd
    ) x
  ),
  rm_info AS (
    SELECT DISTINCT ON (ira.investor_code) 
      ira.investor_code AS inv_code,
      ira.rm_name,
      ira.department
    FROM investor_rm_assignments ira
    ORDER BY ira.investor_code, ira.percentage DESC, ira.updated_at DESC
  ),
  combined AS (
    SELECT
      a.inv_code,
      COALESCE(inv.investor_name, cli.investor_name, '') AS inv_name,
      COALESCE(inv.account_type, '') AS acc_type,
      COALESCE(rm.rm_name, cli.rm_name, '') AS rm_val,
      COALESCE(rm.department, '') AS dept_val,
      COALESCE(ob.opening, 0) AS open_bal,
      COALESCE(dd.dep_sum, 0) AS dep_amt,
      COALESCE(dd.wd_sum, 0) AS wd_amt,
      COALESCE(dt.buy_sum, 0) AS buy_amt,
      COALESCE(dt.sell_sum, 0) AS sell_amt,
      COALESCE(dt.commission_sum, 0) AS comm_amt,
      COALESCE(ob.opening, 0) 
        + COALESCE(dd.dep_sum, 0) 
        - COALESCE(dd.wd_sum, 0) 
        - COALESCE(dt.buy_sum, 0) 
        + COALESCE(dt.sell_sum, 0)
        - COALESCE(dt.commission_sum, 0) AS close_bal
    FROM all_codes a
    LEFT JOIN investors inv ON a.inv_code = inv.investor_code
    LEFT JOIN clients cli ON a.inv_code = cli.inv_code
    LEFT JOIN opening_bal ob ON a.inv_code = ob.inv_code
    LEFT JOIN day_trades dt ON a.inv_code = dt.inv_code
    LEFT JOIN day_deposits dd ON a.inv_code = dd.inv_code
    LEFT JOIN rm_info rm ON a.inv_code = rm.inv_code
  )
  SELECT
    c.inv_code,
    c.inv_name,
    c.acc_type,
    c.rm_val,
    c.dept_val,
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
    AND (
      _has_activity_filter = 'all'
      OR (_has_activity_filter IN ('with_activity', 'with_trades') AND (c.buy_amt > 0 OR c.sell_amt > 0 OR c.dep_amt > 0 OR c.wd_amt > 0))
      OR (_has_activity_filter IN ('no_activity', 'no_trades') AND c.buy_amt = 0 AND c.sell_amt = 0 AND c.dep_amt = 0 AND c.wd_amt = 0)
    )
  ORDER BY c.inv_code
  LIMIT _limit OFFSET _offset;
$$;