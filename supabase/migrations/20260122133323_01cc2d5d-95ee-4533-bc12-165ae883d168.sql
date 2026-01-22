
-- Drop the broken 7-parameter version that references rm.is_primary
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(date, date, text, text, text, integer, integer);

-- Recreate with correct RM/Department lookup logic
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT '',
  _has_activity_filter text DEFAULT '',
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
  opening_ledger_balance numeric,
  deposits numeric,
  withdrawals numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage numeric,
  closing_ledger_balance numeric,
  accrued_interest numeric,
  margin_loan numeric,
  equity numeric,
  has_trades boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
BEGIN
  RETURN QUERY
  WITH investor_base AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.rm_id,
      i.rm_name AS master_rm_name,
      i.department AS master_department
    FROM investors i
    WHERE 
      (_search = '' OR 
       i.investor_code ILIKE '%' || _search || '%' OR 
       i.investor_name ILIKE '%' || _search || '%')
      AND (_account_type_filter = '' OR LOWER(i.account_type) = LOWER(_account_type_filter))
  ),
  -- Get highest percentage RM assignment for each investor
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_name,
      ira.rm_email
    FROM investor_rm_assignments ira
    WHERE ira.investor_code IN (SELECT investor_code FROM investor_base)
    ORDER BY ira.investor_code, ira.percentage DESC NULLS LAST, ira.created_at DESC
  ),
  -- Opening balances from balances_raw
  opening_balances AS (
    SELECT 
      br.bo_id AS investor_code,
      COALESCE(br.ledger_balance, 0) AS opening_ledger_balance,
      COALESCE(br.accrued_interest, 0) AS accrued_interest,
      COALESCE(br.margin_loan, 0) AS margin_loan,
      COALESCE(br.equity, 0) AS equity
    FROM balances_raw br
    WHERE br.balance_date = _opening_date
      AND br.bo_id IN (SELECT investor_code FROM investor_base)
  ),
  -- Deposits in period
  period_deposits AS (
    SELECT 
      dw.bo_id AS investor_code,
      COALESCE(SUM(dw.amount), 0) AS deposits
    FROM deposits_withdrawals dw
    WHERE dw.type = 'Deposit'
      AND dw.transaction_date > _opening_date
      AND dw.transaction_date <= _tx_date
      AND dw.bo_id IN (SELECT investor_code FROM investor_base)
    GROUP BY dw.bo_id
  ),
  -- Withdrawals in period
  period_withdrawals AS (
    SELECT 
      dw.bo_id AS investor_code,
      COALESCE(SUM(dw.amount), 0) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.type = 'Withdrawal'
      AND dw.transaction_date > _opening_date
      AND dw.transaction_date <= _tx_date
      AND dw.bo_id IN (SELECT investor_code FROM investor_base)
    GROUP BY dw.bo_id
  ),
  -- Trades in period
  period_trades AS (
    SELECT 
      th.bo_id AS investor_code,
      COALESCE(SUM(CASE WHEN th.transaction_type = 'Buy' THEN th.total_value ELSE 0 END), 0) AS net_buy,
      COALESCE(SUM(CASE WHEN th.transaction_type = 'Sell' THEN th.total_value ELSE 0 END), 0) AS net_sell,
      COALESCE(SUM(th.commission), 0) AS brokerage,
      TRUE AS has_trades
    FROM trade_history th
    WHERE th.transaction_date > _opening_date
      AND th.transaction_date <= _tx_date
      AND th.bo_id IN (SELECT investor_code FROM investor_base)
    GROUP BY th.bo_id
  )
  SELECT 
    ib.investor_code,
    ib.investor_name,
    -- RM Name: prioritize master, then assignment
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm,
    COALESCE(ib.master_rm_name, ra.rm_name, '')::text AS rm_name,
    -- Department: Priority 1 = master rm_id match, Priority 2 = assignment email match, Fallback = master department
    COALESCE(
      e_master.department,
      e_assign.department,
      ib.master_department,
      ''
    )::text AS department,
    COALESCE(ib.account_type, '')::text AS account_type,
    COALESCE(ob.opening_ledger_balance, 0) AS opening_ledger_balance,
    COALESCE(pd.deposits, 0) AS deposits,
    COALESCE(pw.withdrawals, 0) AS withdrawals,
    COALESCE(pt.net_buy, 0) AS net_buy,
    COALESCE(pt.net_sell, 0) AS net_sell,
    COALESCE(pt.brokerage, 0) AS brokerage,
    -- Closing = Opening + Deposits - Withdrawals + Net Sell - Net Buy - Brokerage
    COALESCE(ob.opening_ledger_balance, 0) 
      + COALESCE(pd.deposits, 0) 
      - COALESCE(pw.withdrawals, 0) 
      + COALESCE(pt.net_sell, 0) 
      - COALESCE(pt.net_buy, 0) 
      - COALESCE(pt.brokerage, 0) AS closing_ledger_balance,
    COALESCE(ob.accrued_interest, 0) AS accrued_interest,
    COALESCE(ob.margin_loan, 0) AS margin_loan,
    COALESCE(ob.equity, 0) AS equity,
    COALESCE(pt.has_trades, FALSE) AS has_trades
  FROM investor_base ib
  -- Priority 1: Match investors.rm_id to employees.employee_id
  LEFT JOIN employees e_master ON e_master.employee_id = ib.rm_id
  -- Get highest percentage RM assignment
  LEFT JOIN rm_assignments ra ON ra.investor_code = ib.investor_code
  -- Priority 2: Match assignment rm_email to employees (exact OR ID-based pattern)
  LEFT JOIN employees e_assign ON (
    LOWER(e_assign.email) = LOWER(ra.rm_email)
    OR LOWER(CONCAT(e_assign.employee_id, '@ucbstock.com.bd')) = LOWER(ra.rm_email)
  )
  LEFT JOIN opening_balances ob ON ob.investor_code = ib.investor_code
  LEFT JOIN period_deposits pd ON pd.investor_code = ib.investor_code
  LEFT JOIN period_withdrawals pw ON pw.investor_code = ib.investor_code
  LEFT JOIN period_trades pt ON pt.investor_code = ib.investor_code
  WHERE 
    -- Activity filter
    (_has_activity_filter = '' OR _has_activity_filter IS NULL)
    OR (_has_activity_filter IN ('yes', 'with_trades') AND COALESCE(pt.has_trades, FALSE) = TRUE)
    OR (_has_activity_filter IN ('no', 'no_trades') AND COALESCE(pt.has_trades, FALSE) = FALSE)
  ORDER BY ib.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;
