-- Drop the incorrectly named function and recreate with correct parameter names
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT ''::text,
  _account_type_filter text DEFAULT 'all'::text,
  _has_activity_filter text DEFAULT 'all'::text,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  rm_email text,
  department text,
  opening_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_trade_value numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  brokerage numeric,
  closing_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _from_date_str TEXT;
  _to_date_str TEXT;
BEGIN
  -- Convert dates to string format for text column comparisons
  _from_date_str := TO_CHAR(_opening_date, 'YYYY-MM-DD');
  _to_date_str := TO_CHAR(_tx_date, 'YYYY-MM-DD');

  RETURN QUERY
  WITH investor_base AS (
    SELECT DISTINCT
      i.investor_code,
      i.investor_name,
      i.account_type,
      COALESCE(i.rm_name, ira.rm_name) AS rm_name,
      COALESCE(
        (SELECT e.email FROM public.employees e WHERE e.employee_id = i.rm_id LIMIT 1),
        ira.rm_email
      ) AS rm_email,
      COALESCE(
        (SELECT e.department FROM public.employees e WHERE e.employee_id = i.rm_id LIMIT 1),
        (SELECT e.department FROM public.employees e WHERE LOWER(e.email) = LOWER(ira.rm_email) LIMIT 1),
        (SELECT e.department FROM public.employees e WHERE e.employee_id || '@ucbstock.com.bd' = ira.rm_email LIMIT 1),
        i.department
      ) AS department
    FROM public.investors i
    LEFT JOIN LATERAL (
      SELECT ira_sub.rm_name, ira_sub.rm_email
      FROM public.investor_rm_assignments ira_sub
      WHERE ira_sub.investor_code = i.investor_code
      ORDER BY ira_sub.percentage DESC
      LIMIT 1
    ) ira ON true
    WHERE (
      _search = '' 
      OR i.investor_code ILIKE '%' || _search || '%'
      OR i.investor_name ILIKE '%' || _search || '%'
    )
    AND (
      _account_type_filter = 'all'
      OR LOWER(COALESCE(i.account_type, '')) = LOWER(_account_type_filter)
    )
  ),
  -- Use eod_ledger_snapshots for opening balance (day before opening_date)
  opening_balances AS (
    SELECT
      els.investor_code,
      COALESCE(els.closing_balance, els.ledger_balance, 0) AS opening_balance
    FROM public.eod_ledger_snapshots els
    WHERE els.eod_date = (_opening_date - INTERVAL '1 day')::date
      AND els.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
  ),
  period_trades AS (
    SELECT
      th.client_code AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_sell,
      -- Calculate brokerage: value * rate / 100
      COALESCE(SUM(
        CASE 
          WHEN COALESCE(th.brokerage_commission, 0.3) >= 0.1 
          THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.3) / 100
          ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.003)
        END
      ), 0) AS brokerage
    FROM public.trade_history th
    WHERE REPLACE(COALESCE(th.trade_date, ''), '-', '') >= REPLACE(_from_date_str, '-', '')
      AND REPLACE(COALESCE(th.trade_date, ''), '-', '') <= REPLACE(_to_date_str, '-', '')
      AND th.client_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY th.client_code
  ),
  period_deposits AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN dw.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN dw.amount ELSE 0 END), 0) AS total_withdrawals
    FROM public.deposits_withdrawals dw
    WHERE dw.transaction_date >= _opening_date
      AND dw.transaction_date <= _tx_date
      AND dw.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY dw.investor_code
  ),
  combined AS (
    SELECT
      ib.investor_code,
      ib.investor_name,
      ib.account_type,
      ib.rm_name,
      ib.rm_email,
      ib.department,
      COALESCE(ob.opening_balance, 0) AS opening_balance,
      COALESCE(pt.gross_buy, 0) AS gross_buy,
      COALESCE(pt.gross_sell, 0) AS gross_sell,
      COALESCE(pt.gross_sell, 0) - COALESCE(pt.gross_buy, 0) AS net_trade_value,
      COALESCE(pd.total_deposits, 0) AS total_deposits,
      COALESCE(pd.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(pt.brokerage, 0) AS brokerage,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Brokerage
      COALESCE(ob.opening_balance, 0) 
        + COALESCE(pd.total_deposits, 0) 
        - COALESCE(pd.total_withdrawals, 0) 
        + COALESCE(pt.gross_sell, 0) 
        - COALESCE(pt.gross_buy, 0) 
        - COALESCE(pt.brokerage, 0) AS closing_balance,
      -- Activity flags
      CASE WHEN pt.gross_buy > 0 OR pt.gross_sell > 0 THEN true ELSE false END AS has_trades,
      CASE WHEN pd.total_deposits > 0 OR pd.total_withdrawals > 0 THEN true ELSE false END AS has_activity
    FROM investor_base ib
    LEFT JOIN opening_balances ob ON ob.investor_code = ib.investor_code
    LEFT JOIN period_trades pt ON pt.investor_code = ib.investor_code
    LEFT JOIN period_deposits pd ON pd.investor_code = ib.investor_code
  ),
  filtered AS (
    SELECT c.*
    FROM combined c
    WHERE (
      _has_activity_filter = 'all'
      OR (_has_activity_filter = 'yes' AND (c.has_trades OR c.has_activity))
      OR (_has_activity_filter = 'no' AND NOT c.has_trades AND NOT c.has_activity)
      OR (_has_activity_filter = 'with_trades' AND c.has_trades)
      OR (_has_activity_filter = 'no_trades' AND NOT c.has_trades)
    )
  ),
  counted AS (
    SELECT COUNT(*) AS total_count FROM filtered
  )
  SELECT
    f.investor_code,
    f.investor_name,
    f.account_type,
    f.rm_name,
    f.rm_email,
    f.department,
    f.opening_balance,
    f.gross_buy,
    f.gross_sell,
    f.net_trade_value,
    f.total_deposits,
    f.total_withdrawals,
    f.brokerage,
    f.closing_balance,
    cnt.total_count
  FROM filtered f
  CROSS JOIN counted cnt
  ORDER BY f.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$function$;