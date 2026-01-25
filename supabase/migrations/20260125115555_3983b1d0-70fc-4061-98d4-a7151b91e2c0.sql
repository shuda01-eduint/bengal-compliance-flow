-- Fix: Calculate commission amount instead of summing commission rate
-- The brokerage_commission column stores the rate (e.g., 0.3 = 0.3%), not the amount
-- This fix multiplies value * rate / 100 to get the actual commission

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
  rm text,
  rm_name text,
  department text,
  account_type text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  brokerage numeric,
  closing_balance numeric,
  has_trades boolean,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
SET search_path = 'public'
AS $$
DECLARE
  v_opening_trade text := TO_CHAR(_opening_date, 'YYYYMMDD');
  v_tx_trade text := TO_CHAR(_tx_date, 'YYYYMMDD');
BEGIN
  RETURN QUERY
  WITH investor_base AS (
    SELECT
      i.investor_code,
      i.investor_name,
      COALESCE(i.account_type, 'Cash') AS account_type,
      i.rm_id,
      i.rm_name AS master_rm_name,
      i.department AS master_department
    FROM public.investors i
    WHERE (
        _search = ''
        OR i.investor_code ILIKE '%' || _search || '%'
        OR i.investor_name ILIKE '%' || _search || '%'
      )
      AND (
        COALESCE(NULLIF(LOWER(_account_type_filter), ''), 'all') = 'all'
        OR LOWER(COALESCE(i.account_type, '')) = LOWER(_account_type_filter)
      )
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_email,
      ira.rm_name
    FROM public.investor_rm_assignments ira
    WHERE ira.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
    ORDER BY ira.investor_code, ira.percentage DESC NULLS LAST, ira.created_at DESC
  ),
  opening_balances AS (
    SELECT
      br.investor_code,
      COALESCE(br.ledger_balance, 0) AS opening_balance
    FROM public.balances_raw br
    WHERE br.as_of_date = _opening_date
      AND br.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
  ),
  period_tx AS (
    SELECT
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) AS withdrawals
    FROM public.deposits_withdrawals dw
    WHERE dw.transaction_date > _opening_date
      AND dw.transaction_date <= _tx_date
      AND dw.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
    GROUP BY dw.investor_code
  ),
  period_trades AS (
    SELECT
      th.client_code AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B','BUY') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S','SELL') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS gross_sell,
      -- FIX: Calculate commission amount = value * rate / 100
      -- Rate is stored as percentage (e.g., 0.3 = 0.3%), default to 0.3% if NULL
      COALESCE(SUM(
        CASE 
          WHEN COALESCE(th.brokerage_commission, 0.3) >= 0.1 
          THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.3) / 100
          ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.003)
        END
      ), 0) AS brokerage,
      (COUNT(*) > 0) AS has_trades
    FROM public.trade_history th
    WHERE REPLACE(COALESCE(th.trade_date, ''), '-', '') > v_opening_trade
      AND REPLACE(COALESCE(th.trade_date, ''), '-', '') <= v_tx_trade
      AND th.client_code IN (SELECT ib.investor_code FROM investor_base ib)
      AND COALESCE(th.value, 0) > 0
      AND (
        UPPER(COALESCE(th.status, '')) IN ('PF','FILL')
        OR UPPER(COALESCE(th.fill_type, '')) IN ('PF','FILL')
      )
    GROUP BY th.client_code
  )
  SELECT
    ib.investor_code::text,
    ib.investor_name::text,
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm,
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm_name,
    COALESCE(e_master.department, e_assign.department, ib.master_department, '')::text AS department,
    ib.account_type::text AS account_type,
    COALESCE(ob.opening_balance, 0)::numeric AS opening_balance,
    COALESCE(tx.deposits, 0)::numeric AS deposits,
    COALESCE(tx.withdrawals, 0)::numeric AS withdrawals,
    COALESCE(tr.gross_buy, 0)::numeric AS gross_buy,
    COALESCE(tr.gross_sell, 0)::numeric AS gross_sell,
    COALESCE(tr.brokerage, 0)::numeric AS brokerage,
    (
      COALESCE(ob.opening_balance, 0)
      + COALESCE(tx.deposits, 0)
      - COALESCE(tx.withdrawals, 0)
      + COALESCE(tr.gross_sell, 0)
      - COALESCE(tr.gross_buy, 0)
      - COALESCE(tr.brokerage, 0)
    )::numeric AS closing_balance,
    COALESCE(tr.has_trades, false)::boolean AS has_trades,
    COUNT(*) OVER()::bigint AS total_count
  FROM investor_base ib
  LEFT JOIN rm_assignments ra ON ra.investor_code = ib.investor_code
  LEFT JOIN opening_balances ob ON ob.investor_code = ib.investor_code
  LEFT JOIN period_tx tx ON tx.investor_code = ib.investor_code
  LEFT JOIN period_trades tr ON tr.investor_code = ib.investor_code
  LEFT JOIN public.employees e_master ON e_master.employee_id = ib.rm_id
  LEFT JOIN public.employees e_assign ON (
    LOWER(e_assign.email) = LOWER(ra.rm_email)
    OR e_assign.employee_id = SPLIT_PART(ra.rm_email, '@', 1)
  )
  WHERE (
    _has_activity_filter = 'all'
    OR (_has_activity_filter = 'yes' AND (
      COALESCE(tr.has_trades, false) = true
      OR COALESCE(tx.deposits, 0) > 0
      OR COALESCE(tx.withdrawals, 0) > 0
    ))
    OR (_has_activity_filter = 'no' AND (
      COALESCE(tr.has_trades, false) = false
      AND COALESCE(tx.deposits, 0) = 0
      AND COALESCE(tx.withdrawals, 0) = 0
    ))
    OR (_has_activity_filter = 'with_trades' AND COALESCE(tr.has_trades, false) = true)
    OR (_has_activity_filter = 'no_trades' AND COALESCE(tr.has_trades, false) = false)
  )
  ORDER BY ib.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;