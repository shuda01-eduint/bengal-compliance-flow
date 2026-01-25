-- Fix: Restore opening balance source from eod_ledger_snapshots
-- Drop and recreate function to handle return type change

DROP FUNCTION IF EXISTS public.get_accounting_data_v3(DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _from_date DATE,
  _to_date DATE,
  _search_term TEXT DEFAULT '',
  _account_type TEXT DEFAULT 'all',
  _activity_filter TEXT DEFAULT 'all',
  _limit INTEGER DEFAULT 100,
  _offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  account_type TEXT,
  rm_name TEXT,
  rm_email TEXT,
  department TEXT,
  opening_balance NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  net_trade_value NUMERIC,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  brokerage NUMERIC,
  closing_balance NUMERIC,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  _opening_date DATE;
  _from_date_str TEXT;
  _to_date_str TEXT;
BEGIN
  -- Calculate opening date (day before from_date)
  _opening_date := _from_date - INTERVAL '1 day';
  
  -- Convert dates to string format for text column comparisons
  _from_date_str := TO_CHAR(_from_date, 'YYYY-MM-DD');
  _to_date_str := TO_CHAR(_to_date, 'YYYY-MM-DD');

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
      _search_term = '' 
      OR i.investor_code ILIKE '%' || _search_term || '%'
      OR i.investor_name ILIKE '%' || _search_term || '%'
    )
    AND (
      _account_type = 'all'
      OR LOWER(COALESCE(i.account_type, '')) = LOWER(_account_type)
    )
  ),
  -- FIXED: Use eod_ledger_snapshots instead of balances_raw for opening balance
  opening_balances AS (
    SELECT
      els.investor_code,
      COALESCE(els.closing_balance, els.ledger_balance, 0) AS opening_balance
    FROM public.eod_ledger_snapshots els
    WHERE els.eod_date = _opening_date
      AND els.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
  ),
  period_trades AS (
    SELECT
      th.inv_code AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.bs) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(th.bs) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_sell,
      -- Calculate actual brokerage amount from value * rate
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
      AND th.inv_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY th.inv_code
  ),
  period_deposits AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN dw.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN dw.amount ELSE 0 END), 0) AS total_withdrawals
    FROM public.deposits_withdrawals dw
    WHERE dw.transaction_date >= _from_date
      AND dw.transaction_date <= _to_date
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
      _activity_filter = 'all'
      OR (_activity_filter = 'yes' AND (c.has_trades OR c.has_activity))
      OR (_activity_filter = 'no' AND NOT c.has_trades AND NOT c.has_activity)
      OR (_activity_filter = 'with_trades' AND c.has_trades)
      OR (_activity_filter = 'no_trades' AND NOT c.has_trades)
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
$$;