-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(DATE, DATE, TEXT, TEXT, TEXT, INTEGER, INTEGER);

-- Recreate with correct source tables
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date DATE,
  _tx_date DATE,
  _search TEXT DEFAULT '',
  _account_type_filter TEXT DEFAULT 'all',
  _has_activity_filter TEXT DEFAULT 'all',
  _limit INTEGER DEFAULT 100,
  _offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  account_type TEXT,
  rm_name TEXT,
  department TEXT,
  opening_balance NUMERIC,
  deposits NUMERIC,
  withdrawals NUMERIC,
  gross_buy NUMERIC,
  gross_sell NUMERIC,
  brokerage NUMERIC,
  closing_balance NUMERIC,
  total_count BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- Get opening balances from eod_ledger_snapshots (preferred) or balances_raw (fallback)
  opening_balances AS (
    -- First try eod_ledger_snapshots for the opening date
    SELECT DISTINCT ON (els.investor_code)
      els.investor_code,
      els.investor_name,
      els.account_type,
      els.rm_name,
      els.department,
      COALESCE(els.closing_balance, 0) AS opening_balance
    FROM eod_ledger_snapshots els
    WHERE els.eod_date = _opening_date
    
    UNION ALL
    
    -- Fallback to balances_raw for investors not in eod_ledger_snapshots
    SELECT DISTINCT ON (br.investor_code)
      br.investor_code,
      NULL AS investor_name,
      NULL AS account_type,
      br.rm_name,
      NULL AS department,
      COALESCE(br.ledger_balance, 0) AS opening_balance
    FROM balances_raw br
    WHERE br.as_of_date = _opening_date
      AND NOT EXISTS (
        SELECT 1 FROM eod_ledger_snapshots els2 
        WHERE els2.investor_code = br.investor_code 
        AND els2.eod_date = _opening_date
      )
  ),
  
  -- Get deposits/withdrawals from cash_ledger_txn (primary) 
  period_tx_new AS (
    SELECT 
      clt.investor_code,
      SUM(CASE WHEN UPPER(clt.type) = 'DEPOSIT' THEN clt.amount ELSE 0 END) AS deposits,
      SUM(CASE WHEN UPPER(clt.type) IN ('WITHDRAW', 'WITHDRAWAL') THEN clt.amount ELSE 0 END) AS withdrawals
    FROM cash_ledger_txn clt
    WHERE clt.txn_date > _opening_date AND clt.txn_date <= _tx_date
    GROUP BY clt.investor_code
  ),
  
  -- Fallback: deposits/withdrawals from legacy deposits_withdrawals table
  period_tx_legacy AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END) AS deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) IN ('WITHDRAW', 'WITHDRAWAL') THEN dw.amount ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date > _opening_date AND dw.transaction_date <= _tx_date
      AND NOT EXISTS (
        SELECT 1 FROM cash_ledger_txn clt2 
        WHERE clt2.investor_code = dw.investor_code 
        AND clt2.txn_date > _opening_date AND clt2.txn_date <= _tx_date
      )
    GROUP BY dw.investor_code
  ),
  
  -- Combined deposits/withdrawals
  period_tx AS (
    SELECT investor_code, deposits, withdrawals FROM period_tx_new
    UNION ALL
    SELECT investor_code, deposits, withdrawals FROM period_tx_legacy
  ),
  
  -- Get trades from trade_file (primary)
  period_trades_new AS (
    SELECT 
      tf.investor_code,
      SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) AS gross_sell,
      SUM(COALESCE(tf.commission, 0)) AS brokerage
    FROM trade_file tf
    WHERE tf.trade_date > _opening_date AND tf.trade_date <= _tx_date
    GROUP BY tf.investor_code
  ),
  
  -- Fallback: trades from legacy trade_history table
  period_trades_legacy AS (
    SELECT 
      th.client_code AS investor_code,
      SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      SUM(COALESCE(th.brokerage_commission, 0)) AS brokerage
    FROM trade_history th
    WHERE th.trade_date > TO_CHAR(_opening_date, 'YYYYMMDD') 
      AND th.trade_date <= TO_CHAR(_tx_date, 'YYYYMMDD')
      AND NOT EXISTS (
        SELECT 1 FROM trade_file tf2 
        WHERE tf2.investor_code = th.client_code 
        AND tf2.trade_date > _opening_date AND tf2.trade_date <= _tx_date
      )
    GROUP BY th.client_code
  ),
  
  -- Combined trades
  period_trades AS (
    SELECT investor_code, gross_buy, gross_sell, brokerage FROM period_trades_new
    UNION ALL
    SELECT investor_code, gross_buy, gross_sell, brokerage FROM period_trades_legacy
  ),
  
  -- Get investor metadata from investors table
  investor_meta AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.rm_name,
      i.department
    FROM investors i
  ),
  
  -- Combine all data sources
  combined AS (
    SELECT DISTINCT ON (COALESCE(ob.investor_code, pt.investor_code, ptx.investor_code))
      COALESCE(ob.investor_code, pt.investor_code, ptx.investor_code) AS investor_code,
      COALESCE(ob.investor_name, im.investor_name) AS investor_name,
      COALESCE(ob.account_type, im.account_type) AS account_type,
      COALESCE(ob.rm_name, im.rm_name) AS rm_name,
      COALESCE(ob.department, im.department) AS department,
      COALESCE(ob.opening_balance, 0) AS opening_balance,
      COALESCE(ptx.deposits, 0) AS deposits,
      COALESCE(ptx.withdrawals, 0) AS withdrawals,
      COALESCE(pt.gross_buy, 0) AS gross_buy,
      COALESCE(pt.gross_sell, 0) AS gross_sell,
      COALESCE(pt.brokerage, 0) AS brokerage
    FROM opening_balances ob
    FULL OUTER JOIN period_trades pt ON ob.investor_code = pt.investor_code
    FULL OUTER JOIN period_tx ptx ON COALESCE(ob.investor_code, pt.investor_code) = ptx.investor_code
    LEFT JOIN investor_meta im ON COALESCE(ob.investor_code, pt.investor_code, ptx.investor_code) = im.investor_code
  ),
  
  -- Calculate closing balance and apply filters
  filtered AS (
    SELECT 
      c.investor_code,
      c.investor_name,
      c.account_type,
      c.rm_name,
      c.department,
      c.opening_balance,
      c.deposits,
      c.withdrawals,
      c.gross_buy,
      c.gross_sell,
      c.brokerage,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Brokerage
      (c.opening_balance + c.deposits - c.withdrawals + c.gross_sell - c.gross_buy - c.brokerage) AS closing_balance
    FROM combined c
    WHERE 
      -- Search filter
      (_search = '' OR 
       c.investor_code ILIKE '%' || _search || '%' OR 
       c.investor_name ILIKE '%' || _search || '%' OR
       c.rm_name ILIKE '%' || _search || '%')
      -- Account type filter
      AND (_account_type_filter = 'all' OR c.account_type = _account_type_filter)
      -- Activity filter
      AND (
        _has_activity_filter = 'all'
        OR (_has_activity_filter = 'with_trades' AND (c.gross_buy > 0 OR c.gross_sell > 0))
        OR (_has_activity_filter = 'with_deposits' AND c.deposits > 0)
        OR (_has_activity_filter = 'with_withdrawals' AND c.withdrawals > 0)
        OR (_has_activity_filter = 'with_activity' AND (c.gross_buy > 0 OR c.gross_sell > 0 OR c.deposits > 0 OR c.withdrawals > 0))
      )
  ),
  
  -- Get total count for pagination
  total AS (
    SELECT COUNT(*) AS cnt FROM filtered
  )
  
  SELECT 
    f.investor_code,
    f.investor_name,
    f.account_type,
    f.rm_name,
    f.department,
    f.opening_balance,
    f.deposits,
    f.withdrawals,
    f.gross_buy,
    f.gross_sell,
    f.brokerage,
    f.closing_balance,
    t.cnt AS total_count
  FROM filtered f
  CROSS JOIN total t
  ORDER BY f.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;