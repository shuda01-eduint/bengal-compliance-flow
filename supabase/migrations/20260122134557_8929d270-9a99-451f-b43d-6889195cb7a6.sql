-- Fix date type mismatches in get_accounting_data_v3
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT 'All',
  _has_activity_filter text DEFAULT 'all',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  department text,
  opening_ledger_balance numeric,
  deposits numeric,
  withdrawals numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage numeric,
  accrued_interest numeric,
  closing_ledger_balance numeric,
  has_trades boolean,
  equity numeric,
  margin_loan numeric,
  rm text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
SET search_path = 'public'
AS $$
DECLARE
  v_opening_date_text text := TO_CHAR(_opening_date, 'YYYY-MM-DD');
  v_tx_date_text text := TO_CHAR(_tx_date, 'YYYY-MM-DD');
  v_opening_date_yyyymmdd text := TO_CHAR(_opening_date, 'YYYYMMDD');
  v_tx_date_yyyymmdd text := TO_CHAR(_tx_date, 'YYYYMMDD');
BEGIN
  RETURN QUERY
  WITH investor_base AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(i.account_type, 'Cash') AS account_type,
      i.rm_id,
      i.rm_name AS master_rm_name,
      i.department AS master_department,
      i.brokerage_commission,
      i.interest_rate
    FROM investors i
    WHERE i.status IS DISTINCT FROM 'Inactive'
      AND (
        _search = '' 
        OR i.investor_code ILIKE '%' || _search || '%'
        OR i.investor_name ILIKE '%' || _search || '%'
      )
      AND (
        _account_type_filter = 'All'
        OR LOWER(i.account_type) = LOWER(_account_type_filter)
      )
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_email,
      ira.rm_name
    FROM investor_rm_assignments ira
    WHERE ira.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
    ORDER BY ira.investor_code, ira.percentage DESC NULLS LAST, ira.created_at DESC
  ),
  opening_balances AS (
    SELECT 
      br.investor_code,
      COALESCE(br.ledger_balance, 0) AS opening_balance
    FROM balances_raw br
    WHERE br.as_of_date = v_opening_date_text
      AND br.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
  ),
  period_deposits AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date >= v_opening_date_text
      AND dw.transaction_date <= v_tx_date_text
      AND dw.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY dw.investor_code
  ),
  period_trades AS (
    SELECT 
      th.client_code AS investor_code,
      SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      SUM(COALESCE(th.brokerage_commission, 0)) AS total_brokerage,
      COUNT(*) > 0 AS has_activity
    FROM trade_history th
    WHERE th.trade_date >= v_opening_date_yyyymmdd
      AND th.trade_date <= v_tx_date_yyyymmdd
      AND th.client_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY th.client_code
  )
  SELECT
    ib.investor_code::text,
    ib.investor_name::text,
    ib.account_type::text,
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm_name,
    COALESCE(e_master.department, e_assign.department, ib.master_department, '')::text AS department,
    COALESCE(ob.opening_balance, 0)::numeric AS opening_ledger_balance,
    COALESCE(pd.total_deposits, 0)::numeric AS deposits,
    COALESCE(pd.total_withdrawals, 0)::numeric AS withdrawals,
    COALESCE(pt.gross_buy, 0)::numeric AS net_buy,
    COALESCE(pt.gross_sell, 0)::numeric AS net_sell,
    COALESCE(pt.total_brokerage, 0)::numeric AS brokerage,
    0::numeric AS accrued_interest,
    (
      COALESCE(ob.opening_balance, 0) 
      + COALESCE(pd.total_deposits, 0) 
      - COALESCE(pd.total_withdrawals, 0) 
      + COALESCE(pt.gross_sell, 0) 
      - COALESCE(pt.gross_buy, 0) 
      - COALESCE(pt.total_brokerage, 0)
    )::numeric AS closing_ledger_balance,
    COALESCE(pt.has_activity, false) AS has_trades,
    0::numeric AS equity,
    0::numeric AS margin_loan,
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm
  FROM investor_base ib
  LEFT JOIN rm_assignments ra ON ra.investor_code = ib.investor_code
  LEFT JOIN employees e_master ON LOWER(e_master.employee_id) = LOWER(ib.rm_id)
  LEFT JOIN employees e_assign ON (
    LOWER(e_assign.email) = LOWER(ra.rm_email)
    OR LOWER(CONCAT(e_assign.employee_id, '@ucbstock.com.bd')) = LOWER(ra.rm_email)
  )
  LEFT JOIN opening_balances ob ON ob.investor_code = ib.investor_code
  LEFT JOIN period_deposits pd ON pd.investor_code = ib.investor_code
  LEFT JOIN period_trades pt ON pt.investor_code = ib.investor_code
  WHERE (
    _has_activity_filter = 'all'
    OR (_has_activity_filter IN ('yes', 'with_trades') AND COALESCE(pt.has_activity, false) = true)
    OR (_has_activity_filter IN ('no', 'no_trades') AND COALESCE(pt.has_activity, false) = false)
  )
  ORDER BY ib.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;