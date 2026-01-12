
-- Drop and recreate get_accounting_data with fixed type comparisons and simplified filter
DROP FUNCTION IF EXISTS get_accounting_data;

CREATE OR REPLACE FUNCTION get_accounting_data(
  _search_term TEXT DEFAULT '',
  _account_type TEXT DEFAULT 'all',
  _has_trades_filter TEXT DEFAULT 'with_activity',
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL,
  _limit_val INT DEFAULT 100,
  _offset_val INT DEFAULT 0
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  account_type TEXT,
  rm_code TEXT,
  rm_name TEXT,
  opening_cash_balance NUMERIC,
  opening_stock_value NUMERIC,
  total_buy NUMERIC,
  total_sell NUMERIC,
  net_trade NUMERIC,
  deposits NUMERIC,
  withdrawals NUMERIC,
  net_deposit_withdrawal NUMERIC,
  commission NUMERIC,
  laga_income NUMERIC,
  closing_cash_balance NUMERIC,
  closing_stock_value NUMERIC,
  equity NUMERIC,
  margin_loan_limit NUMERIC,
  margin_used NUMERIC,
  margin_available NUMERIC,
  exposure_ratio NUMERIC,
  trade_count BIGINT,
  last_trade_date TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_investors AS (
    SELECT i.investor_code, i.investor_name, i.account_type, i.rm_code, i.rm_name, i.margin_loan_limit
    FROM investors i
    WHERE 
      -- Search filter
      (
        _search_term = '' OR
        i.investor_code ILIKE '%' || _search_term || '%' OR
        i.investor_name ILIKE '%' || _search_term || '%' OR
        i.rm_code ILIKE '%' || _search_term || '%'
      )
      -- Account type filter
      AND (_account_type = 'all' OR i.account_type = _account_type)
      -- Only show investors with activity (trades OR deposits/withdrawals)
      AND (
        EXISTS (
          SELECT 1 FROM trade_history th2 
          WHERE th2.client_code = i.investor_code
          AND th2.trade_date >= _from_trade_date
          AND th2.trade_date <= _to_trade_date
        )
        OR EXISTS (
          SELECT 1 FROM deposits_withdrawals dw2
          WHERE dw2.investor_code = i.investor_code
          AND dw2.transaction_date >= _from_tx_date::date
          AND dw2.transaction_date <= _to_tx_date::date
        )
      )
  ),
  opening_balances AS (
    SELECT 
      ob.investor_code,
      COALESCE(ob.cash_balance, 0) as cash_balance,
      COALESCE(ob.stock_value, 0) as stock_value
    FROM opening_balances ob
    WHERE ob.balance_date = _from_trade_date
  ),
  trade_summary AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.bs = 'B' THEN COALESCE(th.net_value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.bs = 'S' THEN COALESCE(th.net_value, 0) ELSE 0 END) as total_sell,
      SUM(COALESCE(th.commission, 0)) as commission,
      SUM(COALESCE(th.laga_income, 0)) as laga_income,
      COUNT(*) as trade_count,
      MAX(th.trade_date) as last_trade_date
    FROM trade_history th
    WHERE th.trade_date >= _from_trade_date
      AND th.trade_date <= _to_trade_date
    GROUP BY th.client_code
  ),
  deposit_withdrawal_summary AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.type = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN dw.type = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date >= _from_tx_date::date
      AND dw.transaction_date <= _to_tx_date::date
    GROUP BY dw.investor_code
  ),
  closing_balances AS (
    SELECT 
      cb.investor_code,
      COALESCE(cb.stock_value, 0) as stock_value
    FROM opening_balances cb
    WHERE cb.balance_date = _to_trade_date
  )
  SELECT 
    fi.investor_code,
    fi.investor_name,
    fi.account_type,
    fi.rm_code,
    fi.rm_name,
    COALESCE(ob.cash_balance, 0) as opening_cash_balance,
    COALESCE(ob.stock_value, 0) as opening_stock_value,
    COALESCE(ts.total_buy, 0) as total_buy,
    COALESCE(ts.total_sell, 0) as total_sell,
    COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0) as net_trade,
    COALESCE(dws.deposits, 0) as deposits,
    COALESCE(dws.withdrawals, 0) as withdrawals,
    COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0) as net_deposit_withdrawal,
    COALESCE(ts.commission, 0) as commission,
    COALESCE(ts.laga_income, 0) as laga_income,
    COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0) as closing_cash_balance,
    COALESCE(clb.stock_value, 0) as closing_stock_value,
    COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0) + COALESCE(clb.stock_value, 0) as equity,
    COALESCE(fi.margin_loan_limit, 0) as margin_loan_limit,
    GREATEST(0, -1 * (COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0))) as margin_used,
    COALESCE(fi.margin_loan_limit, 0) - GREATEST(0, -1 * (COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0))) as margin_available,
    CASE 
      WHEN COALESCE(fi.margin_loan_limit, 0) > 0 
      THEN (GREATEST(0, -1 * (COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0))) / COALESCE(fi.margin_loan_limit, 1)) * 100
      ELSE 0 
    END as exposure_ratio,
    COALESCE(ts.trade_count, 0) as trade_count,
    ts.last_trade_date
  FROM filtered_investors fi
  LEFT JOIN opening_balances ob ON ob.investor_code = fi.investor_code
  LEFT JOIN trade_summary ts ON ts.client_code = fi.investor_code
  LEFT JOIN deposit_withdrawal_summary dws ON dws.investor_code = fi.investor_code
  LEFT JOIN closing_balances clb ON clb.investor_code = fi.investor_code
  ORDER BY fi.investor_code
  LIMIT _limit_val OFFSET _offset_val;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate get_accounting_summary with fixed type comparisons and simplified filter
DROP FUNCTION IF EXISTS get_accounting_summary;

CREATE OR REPLACE FUNCTION get_accounting_summary(
  _search_term TEXT DEFAULT '',
  _account_type TEXT DEFAULT 'all',
  _has_trades_filter TEXT DEFAULT 'with_activity',
  _from_trade_date TEXT DEFAULT NULL,
  _to_trade_date TEXT DEFAULT NULL,
  _from_tx_date TEXT DEFAULT NULL,
  _to_tx_date TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_investors BIGINT,
  total_opening_cash NUMERIC,
  total_opening_stock NUMERIC,
  total_buy NUMERIC,
  total_sell NUMERIC,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  total_commission NUMERIC,
  total_laga_income NUMERIC,
  total_closing_cash NUMERIC,
  total_closing_stock NUMERIC,
  total_equity NUMERIC,
  total_margin_limit NUMERIC,
  total_margin_used NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_investors AS (
    SELECT i.investor_code, i.margin_loan_limit
    FROM investors i
    WHERE 
      -- Search filter
      (
        _search_term = '' OR
        i.investor_code ILIKE '%' || _search_term || '%' OR
        i.investor_name ILIKE '%' || _search_term || '%' OR
        i.rm_code ILIKE '%' || _search_term || '%'
      )
      -- Account type filter
      AND (_account_type = 'all' OR i.account_type = _account_type)
      -- Only show investors with activity (trades OR deposits/withdrawals)
      AND (
        EXISTS (
          SELECT 1 FROM trade_history th2 
          WHERE th2.client_code = i.investor_code
          AND th2.trade_date >= _from_trade_date
          AND th2.trade_date <= _to_trade_date
        )
        OR EXISTS (
          SELECT 1 FROM deposits_withdrawals dw2
          WHERE dw2.investor_code = i.investor_code
          AND dw2.transaction_date >= _from_tx_date::date
          AND dw2.transaction_date <= _to_tx_date::date
        )
      )
  ),
  opening_balances AS (
    SELECT 
      ob.investor_code,
      COALESCE(ob.cash_balance, 0) as cash_balance,
      COALESCE(ob.stock_value, 0) as stock_value
    FROM opening_balances ob
    WHERE ob.balance_date = _from_trade_date
  ),
  trade_summary AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.bs = 'B' THEN COALESCE(th.net_value, 0) ELSE 0 END) as total_buy,
      SUM(CASE WHEN th.bs = 'S' THEN COALESCE(th.net_value, 0) ELSE 0 END) as total_sell,
      SUM(COALESCE(th.commission, 0)) as commission,
      SUM(COALESCE(th.laga_income, 0)) as laga_income
    FROM trade_history th
    WHERE th.trade_date >= _from_trade_date
      AND th.trade_date <= _to_trade_date
    GROUP BY th.client_code
  ),
  deposit_withdrawal_summary AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN dw.type = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN dw.type = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date >= _from_tx_date::date
      AND dw.transaction_date <= _to_tx_date::date
    GROUP BY dw.investor_code
  ),
  closing_balances AS (
    SELECT 
      cb.investor_code,
      COALESCE(cb.stock_value, 0) as stock_value
    FROM opening_balances cb
    WHERE cb.balance_date = _to_trade_date
  ),
  investor_data AS (
    SELECT 
      COALESCE(ob.cash_balance, 0) as opening_cash,
      COALESCE(ob.stock_value, 0) as opening_stock,
      COALESCE(ts.total_buy, 0) as buy,
      COALESCE(ts.total_sell, 0) as sell,
      COALESCE(dws.deposits, 0) as dep,
      COALESCE(dws.withdrawals, 0) as wdl,
      COALESCE(ts.commission, 0) as comm,
      COALESCE(ts.laga_income, 0) as laga,
      COALESCE(clb.stock_value, 0) as closing_stock,
      COALESCE(fi.margin_loan_limit, 0) as margin_limit,
      COALESCE(ob.cash_balance, 0) + (COALESCE(ts.total_sell, 0) - COALESCE(ts.total_buy, 0)) + (COALESCE(dws.deposits, 0) - COALESCE(dws.withdrawals, 0)) - COALESCE(ts.commission, 0) as closing_cash
    FROM filtered_investors fi
    LEFT JOIN opening_balances ob ON ob.investor_code = fi.investor_code
    LEFT JOIN trade_summary ts ON ts.client_code = fi.investor_code
    LEFT JOIN deposit_withdrawal_summary dws ON dws.investor_code = fi.investor_code
    LEFT JOIN closing_balances clb ON clb.investor_code = fi.investor_code
  )
  SELECT 
    COUNT(*)::BIGINT as total_investors,
    SUM(id.opening_cash) as total_opening_cash,
    SUM(id.opening_stock) as total_opening_stock,
    SUM(id.buy) as total_buy,
    SUM(id.sell) as total_sell,
    SUM(id.dep) as total_deposits,
    SUM(id.wdl) as total_withdrawals,
    SUM(id.comm) as total_commission,
    SUM(id.laga) as total_laga_income,
    SUM(id.closing_cash) as total_closing_cash,
    SUM(id.closing_stock) as total_closing_stock,
    SUM(id.closing_cash + id.closing_stock) as total_equity,
    SUM(id.margin_limit) as total_margin_limit,
    SUM(GREATEST(0, -1 * id.closing_cash)) as total_margin_used
  FROM investor_data id;
END;
$$ LANGUAGE plpgsql;
