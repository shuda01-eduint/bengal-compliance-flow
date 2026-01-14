-- Add account type and activity filters to get_accounting_data function

DROP FUNCTION IF EXISTS get_accounting_data(text,text,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION get_accounting_data(
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit integer DEFAULT 500,
  _offset integer DEFAULT 0,
  _account_type_filter text DEFAULT 'all',
  _has_activity_filter text DEFAULT 'all'
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  rm text,
  department text,
  account_type text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH investor_base AS (
    SELECT DISTINCT i.investor_code AS inv_code, i.investor_name, i.brokerage_commission, i.account_type
    FROM investors i
    WHERE (_search IS NULL OR _search = '' 
           OR i.investor_code ILIKE '%' || _search || '%'
           OR i.investor_name ILIKE '%' || _search || '%')
    -- Apply account type filter at base level for efficiency
    AND (
      _account_type_filter IS NULL 
      OR _account_type_filter = 'all' 
      OR UPPER(COALESCE(i.account_type, 'CASH')) = UPPER(_account_type_filter)
    )
    LIMIT _limit OFFSET _offset
  ),
  trade_sums AS (
    SELECT
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END) AS buy_turnover,
      SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END) AS sell_turnover,
      SUM(
        CASE 
          WHEN th.brokerage_commission IS NOT NULL 
          THEN COALESCE(th.value * th.brokerage_commission, 0)
          ELSE COALESCE(th.value * ib.brokerage_commission, 0)
        END
      ) AS brokerage
    FROM trade_history th
    INNER JOIN investor_base ib ON th.client_code = ib.inv_code
    WHERE (
      (_to_trade_date IS NULL OR th.trade_date <= REPLACE(_to_trade_date, '-', ''))
      AND (_from_trade_date IS NULL OR th.trade_date >= REPLACE(_from_trade_date, '-', ''))
    )
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    INNER JOIN investor_base ib ON dw.investor_code = ib.inv_code
    WHERE (
      (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    )
    GROUP BY dw.investor_code
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_name,
      ira.rm_email,
      ira.department
    FROM investor_rm_assignments ira
    INNER JOIN investor_base ib ON ira.investor_code = ib.inv_code
    ORDER BY ira.investor_code, ira.percentage DESC, ira.created_at DESC
  ),
  combined AS (
    SELECT
      ib.inv_code,
      COALESCE(ib.investor_name, c.investor_name) AS investor_name,
      COALESCE(ra.rm_name, c.rm_name, 'Unassigned') AS rm,
      COALESCE(ra.department, 'Unassigned') AS department,
      COALESCE(ib.account_type, 'Cash') AS account_type,
      COALESCE(c.ledger_balance, 0) AS opening_balance,
      COALESCE(ds.total_deposits, 0) AS deposits,
      COALESCE(ds.total_withdrawals, 0) AS withdrawals,
      COALESCE(ts.buy_turnover, 0) + COALESCE(ts.brokerage, 0) AS gross_buy,
      COALESCE(ts.sell_turnover, 0) AS gross_sell,
      COALESCE(c.ledger_balance, 0) 
        + COALESCE(ds.total_deposits, 0) 
        - COALESCE(ds.total_withdrawals, 0) 
        + COALESCE(ts.sell_turnover, 0) 
        - COALESCE(ts.buy_turnover, 0) 
        - COALESCE(ts.brokerage, 0) AS closing_balance,
      -- Calculate total activity for filtering
      COALESCE(ts.buy_turnover, 0) + COALESCE(ts.sell_turnover, 0) + 
      COALESCE(ds.total_deposits, 0) + COALESCE(ds.total_withdrawals, 0) AS total_activity
    FROM investor_base ib
    LEFT JOIN clients c ON ib.inv_code = c.inv_code
    LEFT JOIN trade_sums ts ON ib.inv_code = ts.client_code
    LEFT JOIN deposit_sums ds ON ib.inv_code = ds.investor_code
    LEFT JOIN rm_assignments ra ON ib.inv_code = ra.investor_code
  )
  SELECT
    combined.inv_code AS investor_code,
    combined.investor_name,
    combined.rm,
    combined.department,
    combined.account_type,
    combined.opening_balance,
    combined.deposits,
    combined.withdrawals,
    combined.gross_buy,
    combined.gross_sell,
    combined.closing_balance
  FROM combined
  WHERE (
    _has_activity_filter IS NULL 
    OR _has_activity_filter = 'all'
    OR (_has_activity_filter = 'with_activity' AND combined.total_activity > 0)
    OR (_has_activity_filter = 'no_activity' AND combined.total_activity = 0)
  );
END;
$$;