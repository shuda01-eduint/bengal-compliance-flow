-- Add composite index for efficient trade lookups
CREATE INDEX IF NOT EXISTS idx_trade_history_fill_type_date 
ON trade_history (fill_type, trade_date, client_code);

-- Add index on deposits_withdrawals for date lookups
CREATE INDEX IF NOT EXISTS idx_deposits_withdrawals_date 
ON deposits_withdrawals (transaction_date, investor_code);

-- Add index on eod_ledger_snapshots for date lookups
CREATE INDEX IF NOT EXISTS idx_eod_ledger_snapshots_date 
ON eod_ledger_snapshots (eod_date, investor_code);

-- Create optimized accounting function using eod_ledger_snapshots for opening balance
CREATE OR REPLACE FUNCTION get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT 'all',
  _has_activity_filter text DEFAULT 'all',
  _limit integer DEFAULT 1000,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  department text,
  rm text,
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
DECLARE
  _trade_date_str text;
BEGIN
  -- Convert tx_date to trade_date format (YYYYMMDD)
  _trade_date_str := to_char(_tx_date, 'YYYYMMDD');
  
  RETURN QUERY
  WITH 
  -- Get opening balances from EOD snapshots (previous day's closing = today's opening)
  opening_balances AS (
    SELECT 
      e.investor_code,
      e.investor_name,
      e.ledger_balance as opening_balance
    FROM eod_ledger_snapshots e
    WHERE e.eod_date = _opening_date
  ),
  
  -- Get trades for the transaction date (pre-filtered by index)
  trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN th.side = 'BUY' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN th.side = 'SELL' THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.fill_type = 'FILL'
      AND th.trade_date = _trade_date_str
    GROUP BY th.client_code
  ),
  
  -- Get deposits/withdrawals for the transaction date
  dw_sums AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) as deposit_sum,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) as withdrawal_sum
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = _tx_date
    GROUP BY dw.investor_code
  ),
  
  -- Get all unique investor codes from any source
  all_investors AS (
    SELECT DISTINCT ob.investor_code FROM opening_balances ob
    UNION
    SELECT DISTINCT ts.client_code FROM trade_sums ts
    UNION
    SELECT DISTINCT dws.investor_code FROM dw_sums dws
  ),
  
  -- Get investor details and RM assignments
  investor_details AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(i.account_type, 'Regular') as account_type,
      COALESCE(ra.department, 'Unassigned') as department,
      COALESCE(ra.rm_name, 'Unassigned') as rm_name
    FROM investors i
    LEFT JOIN LATERAL (
      SELECT ira.department, ira.rm_name 
      FROM investor_rm_assignments ira
      WHERE ira.investor_code = i.investor_code 
      LIMIT 1
    ) ra ON true
  ),
  
  -- Combine all data
  combined AS (
    SELECT 
      ai.investor_code,
      COALESCE(id.investor_name, ob.investor_name, ai.investor_code) as investor_name,
      COALESCE(id.account_type, 'Regular') as account_type,
      COALESCE(id.department, 'Unassigned') as department,
      COALESCE(id.rm_name, 'Unassigned') as rm,
      COALESCE(ob.opening_balance, 0) as opening_balance,
      COALESCE(dw.deposit_sum, 0) as deposits,
      COALESCE(dw.withdrawal_sum, 0) as withdrawals,
      COALESCE(ts.buy_sum, 0) as gross_buy,
      COALESCE(ts.sell_sum, 0) as gross_sell,
      -- Closing = Opening + Deposits - Withdrawals - Buys + Sells
      COALESCE(ob.opening_balance, 0) 
        + COALESCE(dw.deposit_sum, 0) 
        - COALESCE(dw.withdrawal_sum, 0) 
        - COALESCE(ts.buy_sum, 0) 
        + COALESCE(ts.sell_sum, 0) as closing_balance
    FROM all_investors ai
    LEFT JOIN opening_balances ob ON ob.investor_code = ai.investor_code
    LEFT JOIN trade_sums ts ON ts.client_code = ai.investor_code
    LEFT JOIN dw_sums dw ON dw.investor_code = ai.investor_code
    LEFT JOIN investor_details id ON id.investor_code = ai.investor_code
  )
  
  SELECT 
    c.investor_code,
    c.investor_name,
    c.account_type,
    c.department,
    c.rm,
    c.opening_balance,
    c.deposits,
    c.withdrawals,
    c.gross_buy,
    c.gross_sell,
    c.closing_balance
  FROM combined c
  WHERE 
    -- Search filter
    (_search = '' OR _search IS NULL OR 
     c.investor_code ILIKE '%' || _search || '%' OR 
     c.investor_name ILIKE '%' || _search || '%')
    -- Account type filter
    AND (_account_type_filter = 'all' OR _account_type_filter IS NULL OR 
         LOWER(c.account_type) = LOWER(_account_type_filter))
    -- Has activity filter
    AND (_has_activity_filter = 'all' OR _has_activity_filter IS NULL OR
         (_has_activity_filter = 'with_trades' AND (c.gross_buy > 0 OR c.gross_sell > 0)) OR
         (_has_activity_filter = 'no_trades' AND c.gross_buy = 0 AND c.gross_sell = 0))
  ORDER BY c.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;