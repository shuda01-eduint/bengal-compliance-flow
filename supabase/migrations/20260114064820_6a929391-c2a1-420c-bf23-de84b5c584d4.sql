
CREATE OR REPLACE FUNCTION public.get_accounting_data(
    _search TEXT DEFAULT NULL,
    _from_trade_date TEXT DEFAULT NULL,
    _to_trade_date TEXT DEFAULT NULL,
    _from_tx_date TEXT DEFAULT NULL,
    _to_tx_date TEXT DEFAULT NULL,
    _account_type_filter TEXT DEFAULT NULL,
    _has_activity_filter TEXT DEFAULT NULL,
    _limit INT DEFAULT 500,
    _offset INT DEFAULT 0
)
RETURNS TABLE (
    investor_code TEXT,
    investor_name TEXT,
    rm TEXT,
    department TEXT,
    account_type TEXT,
    opening_balance NUMERIC,
    deposits NUMERIC,
    withdrawals NUMERIC,
    gross_buy NUMERIC,
    gross_sell NUMERIC,
    closing_balance NUMERIC
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
        AND (
          _account_type_filter IS NULL 
          OR _account_type_filter = 'all' 
          OR UPPER(COALESCE(i.account_type, 'CASH')) = UPPER(_account_type_filter)
        )
    ),
    trade_sums AS (
        SELECT 
            th.client_code,
            COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
            COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
        FROM trade_history th
        WHERE th.client_code IN (SELECT inv_code FROM investor_base)
        AND (
            _from_trade_date IS NULL 
            OR th.trade_date >= _from_trade_date::DATE
        )
        AND (
            _to_trade_date IS NULL 
            OR th.trade_date <= _to_trade_date::DATE
        )
        GROUP BY th.client_code
    ),
    deposit_sums AS (
        SELECT 
            dw.investor_code AS inv_code,
            COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) AS total_deposits,
            COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) AS total_withdrawals
        FROM deposits_withdrawals dw
        WHERE dw.investor_code IN (SELECT inv_code FROM investor_base)
        AND (
            _from_tx_date IS NULL 
            OR dw.transaction_date >= _from_tx_date::DATE
        )
        AND (
            _to_tx_date IS NULL 
            OR dw.transaction_date <= _to_tx_date::DATE
        )
        GROUP BY dw.investor_code
    ),
    rm_assignments AS (
        SELECT DISTINCT ON (ira.investor_code)
            ira.investor_code AS inv_code,
            ira.rm_name,
            ira.department
        FROM investor_rm_assignments ira
        WHERE ira.investor_code IN (SELECT inv_code FROM investor_base)
        ORDER BY ira.investor_code, ira.percentage DESC
    ),
    combined AS (
        SELECT
            ib.inv_code,
            ib.investor_name,
            COALESCE(ra.rm_name, 'Unassigned') AS rm,
            COALESCE(ra.department, 'Unknown') AS department,
            COALESCE(ib.account_type, 'Cash') AS account_type,
            0::NUMERIC AS opening_balance,
            COALESCE(ds.total_deposits, 0) AS deposits,
            COALESCE(ds.total_withdrawals, 0) AS withdrawals,
            COALESCE(ts.buy_sum, 0) AS gross_buy,
            COALESCE(ts.sell_sum, 0) AS gross_sell,
            (0 + COALESCE(ds.total_deposits, 0) - COALESCE(ds.total_withdrawals, 0) - COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0))::NUMERIC AS closing_balance,
            (COALESCE(ts.buy_sum, 0) + COALESCE(ts.sell_sum, 0) + COALESCE(ds.total_deposits, 0) + COALESCE(ds.total_withdrawals, 0)) AS total_activity
        FROM investor_base ib
        LEFT JOIN trade_sums ts ON ts.client_code = ib.inv_code
        LEFT JOIN deposit_sums ds ON ds.inv_code = ib.inv_code
        LEFT JOIN rm_assignments ra ON ra.inv_code = ib.inv_code
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
    )
    ORDER BY combined.inv_code
    LIMIT _limit OFFSET _offset;
END;
$$;
