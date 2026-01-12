-- Drop all overloaded versions of get_accounting_data and get_accounting_summary
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, text, text, text, text);

-- Create single get_accounting_data function with correct signature
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0,
  _account_type_filter text DEFAULT 'all',
  _has_trades_filter text DEFAULT 'all',
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc'
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  ledger_balance numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_amount numeric,
  adjusted_ledger numeric,
  accrued_interest numeric,
  receivable numeric,
  payable numeric,
  final_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_is_admin boolean := false;
  v_total bigint;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  
  -- Check if admin
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id = v_user_id AND role = 'admin') INTO v_is_admin;

  -- Build and return results
  RETURN QUERY
  WITH accessible_investors AS (
    SELECT i.investor_code, i.investor_name, i.account_type, i.interest_rate, i.brokerage_commission
    FROM investors i
    WHERE v_is_admin 
       OR EXISTS(SELECT 1 FROM investor_rm_assignments ira WHERE ira.investor_code = i.investor_code AND ira.rm_email = v_user_email)
       OR EXISTS(
         SELECT 1 FROM outlet_managers om 
         JOIN investor_rm_assignments ira ON ira.rm_email = om.manager_email OR ira.department = om.outlet_name
         WHERE om.mancom_email = v_user_email AND ira.investor_code = i.investor_code
       )
  ),
  trade_agg AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      MAX(th.ledger_balance_snapshot) AS ledger_snapshot
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  client_ledger AS (
    SELECT c.inv_code, c.ledger_balance
    FROM clients c
  ),
  combined AS (
    SELECT 
      ai.investor_code,
      ai.investor_name,
      ai.account_type,
      COALESCE(ai.interest_rate, 0)::numeric AS interest_rate,
      COALESCE(ai.brokerage_commission, 0)::numeric AS brokerage_commission,
      COALESCE(ta.ledger_snapshot, cl.ledger_balance, 0)::numeric AS ledger_balance,
      COALESCE(tx.deposits, 0)::numeric AS total_deposits,
      COALESCE(tx.withdrawals, 0)::numeric AS total_withdrawals,
      COALESCE(ta.gross_buy, 0)::numeric AS gross_buy,
      COALESCE(ta.gross_sell, 0)::numeric AS gross_sell,
      COALESCE(ta.gross_buy, 0)::numeric AS net_buy,
      COALESCE(ta.gross_sell, 0)::numeric AS net_sell,
      ((COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0)) * COALESCE(ai.brokerage_commission, 0))::numeric AS brokerage_amount,
      (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0)) AS trade_value
    FROM accessible_investors ai
    LEFT JOIN trade_agg ta ON ta.client_code = ai.investor_code
    LEFT JOIN tx_agg tx ON tx.investor_code = ai.investor_code
    LEFT JOIN client_ledger cl ON cl.inv_code = ai.investor_code
    WHERE (
      _search_term IS NULL 
      OR ai.investor_code ILIKE '%' || _search_term || '%'
      OR ai.investor_name ILIKE '%' || _search_term || '%'
    )
    AND (
      _account_type_filter IS NULL 
      OR _account_type_filter = 'all' 
      OR UPPER(ai.account_type) = UPPER(_account_type_filter)
    )
    AND (
      _has_trades_filter IS NULL 
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) + COALESCE(tx.deposits, 0) + COALESCE(tx.withdrawals, 0) > 0))
      OR (_has_trades_filter = 'no_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) + COALESCE(tx.deposits, 0) + COALESCE(tx.withdrawals, 0) = 0))
    )
  )
  SELECT 
    c.investor_code,
    c.investor_name,
    c.account_type,
    c.interest_rate,
    c.brokerage_commission,
    c.ledger_balance,
    c.total_deposits,
    c.total_withdrawals,
    c.gross_buy,
    c.gross_sell,
    c.net_buy,
    c.net_sell,
    c.brokerage_amount,
    (c.ledger_balance + c.total_deposits - c.total_withdrawals)::numeric AS adjusted_ledger,
    (CASE WHEN UPPER(c.account_type) = 'MARGIN' THEN (c.ledger_balance * c.interest_rate / 365) ELSE 0 END)::numeric AS accrued_interest,
    (CASE WHEN c.gross_sell > c.gross_buy THEN c.gross_sell - c.gross_buy - c.brokerage_amount ELSE 0 END)::numeric AS receivable,
    (CASE WHEN c.gross_buy > c.gross_sell THEN c.gross_buy - c.gross_sell + c.brokerage_amount ELSE 0 END)::numeric AS payable,
    (c.ledger_balance + c.total_deposits - c.total_withdrawals - c.gross_buy + c.gross_sell - c.brokerage_amount)::numeric AS final_balance,
    COUNT(*) OVER()::bigint AS total_count
  FROM combined c
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.investor_code
        WHEN 'investor_name' THEN c.investor_name
        WHEN 'account_type' THEN c.account_type
        ELSE c.investor_code
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN c.investor_code
        WHEN 'investor_name' THEN c.investor_name
        WHEN 'account_type' THEN c.account_type
        ELSE c.investor_code
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN c.ledger_balance
        WHEN 'gross_buy' THEN c.gross_buy
        WHEN 'gross_sell' THEN c.gross_sell
        WHEN 'final_balance' THEN (c.ledger_balance + c.total_deposits - c.total_withdrawals - c.gross_buy + c.gross_sell - c.brokerage_amount)
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN c.ledger_balance
        WHEN 'gross_buy' THEN c.gross_buy
        WHEN 'gross_sell' THEN c.gross_sell
        WHEN 'final_balance' THEN (c.ledger_balance + c.total_deposits - c.total_withdrawals - c.gross_buy + c.gross_sell - c.brokerage_amount)
        ELSE NULL
      END
    END DESC NULLS LAST
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;

-- Create single get_accounting_summary function
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  _search_term text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _account_type_filter text DEFAULT 'all',
  _has_trades_filter text DEFAULT 'all'
)
RETURNS TABLE(
  total_accounts bigint,
  margin_accounts bigint,
  total_margin_loan numeric,
  total_accrued_interest numeric,
  total_receivable numeric,
  total_payable numeric,
  total_buy numeric,
  total_sell numeric,
  total_trade_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_is_admin boolean := false;
BEGIN
  v_user_id := auth.uid();
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id = v_user_id AND role = 'admin') INTO v_is_admin;

  RETURN QUERY
  WITH accessible_investors AS (
    SELECT i.investor_code, i.investor_name, i.account_type, i.interest_rate, i.brokerage_commission
    FROM investors i
    WHERE v_is_admin 
       OR EXISTS(SELECT 1 FROM investor_rm_assignments ira WHERE ira.investor_code = i.investor_code AND ira.rm_email = v_user_email)
       OR EXISTS(
         SELECT 1 FROM outlet_managers om 
         JOIN investor_rm_assignments ira ON ira.rm_email = om.manager_email OR ira.department = om.outlet_name
         WHERE om.mancom_email = v_user_email AND ira.investor_code = i.investor_code
       )
  ),
  trade_agg AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      MAX(th.ledger_balance_snapshot) AS ledger_snapshot
    FROM trade_history th
    WHERE (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::date)
    GROUP BY dw.investor_code
  ),
  client_ledger AS (
    SELECT c.inv_code, c.ledger_balance FROM clients c
  ),
  combined AS (
    SELECT 
      ai.investor_code,
      ai.account_type,
      COALESCE(ai.interest_rate, 0)::numeric AS interest_rate,
      COALESCE(ai.brokerage_commission, 0)::numeric AS brokerage_commission,
      COALESCE(ta.ledger_snapshot, cl.ledger_balance, 0)::numeric AS ledger_balance,
      COALESCE(tx.deposits, 0)::numeric AS total_deposits,
      COALESCE(tx.withdrawals, 0)::numeric AS total_withdrawals,
      COALESCE(ta.gross_buy, 0)::numeric AS gross_buy,
      COALESCE(ta.gross_sell, 0)::numeric AS gross_sell,
      ((COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0)) * COALESCE(ai.brokerage_commission, 0))::numeric AS brokerage_amount
    FROM accessible_investors ai
    LEFT JOIN trade_agg ta ON ta.client_code = ai.investor_code
    LEFT JOIN tx_agg tx ON tx.investor_code = ai.investor_code
    LEFT JOIN client_ledger cl ON cl.inv_code = ai.investor_code
    WHERE (
      _search_term IS NULL 
      OR ai.investor_code ILIKE '%' || _search_term || '%'
    )
    AND (
      _account_type_filter IS NULL 
      OR _account_type_filter = 'all' 
      OR UPPER(ai.account_type) = UPPER(_account_type_filter)
    )
    AND (
      _has_trades_filter IS NULL 
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) + COALESCE(tx.deposits, 0) + COALESCE(tx.withdrawals, 0) > 0))
      OR (_has_trades_filter = 'no_activity' AND (COALESCE(ta.gross_buy, 0) + COALESCE(ta.gross_sell, 0) + COALESCE(tx.deposits, 0) + COALESCE(tx.withdrawals, 0) = 0))
    )
  )
  SELECT
    COUNT(*)::bigint AS total_accounts,
    COUNT(*) FILTER (WHERE UPPER(c.account_type) = 'MARGIN')::bigint AS margin_accounts,
    SUM(CASE WHEN UPPER(c.account_type) = 'MARGIN' AND c.ledger_balance < 0 THEN ABS(c.ledger_balance) ELSE 0 END)::numeric AS total_margin_loan,
    SUM(CASE WHEN UPPER(c.account_type) = 'MARGIN' THEN (c.ledger_balance * c.interest_rate / 365) ELSE 0 END)::numeric AS total_accrued_interest,
    SUM(CASE WHEN c.gross_sell > c.gross_buy THEN c.gross_sell - c.gross_buy - c.brokerage_amount ELSE 0 END)::numeric AS total_receivable,
    SUM(CASE WHEN c.gross_buy > c.gross_sell THEN c.gross_buy - c.gross_sell + c.brokerage_amount ELSE 0 END)::numeric AS total_payable,
    SUM(c.gross_buy)::numeric AS total_buy,
    SUM(c.gross_sell)::numeric AS total_sell,
    SUM(c.gross_buy + c.gross_sell)::numeric AS total_trade_value
  FROM combined c;
END;
$$;