-- Update get_accounting_data to include trades with value > 0 even if status is empty
CREATE OR REPLACE FUNCTION public.get_accounting_data(_search_term text DEFAULT NULL::text, _from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date date DEFAULT NULL::date, _to_tx_date date DEFAULT NULL::date, _page_size integer DEFAULT 50, _page_offset integer DEFAULT 0, _account_type_filter text DEFAULT 'all'::text, _has_trades_filter text DEFAULT 'all'::text)
 RETURNS TABLE(investor_code text, investor_name text, account_type text, interest_rate numeric, brokerage_commission numeric, ledger_balance numeric, total_deposits numeric, total_withdrawals numeric, gross_buy numeric, gross_sell numeric, net_sell numeric, adjusted_ledger numeric, accrued_interest numeric, brokerage_amount numeric, final_balance numeric, receivable numeric, payable numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _total bigint;
  _latest_balance_date date;
  _user_email text;
  _is_admin boolean;
  _is_dept_head boolean;
  _is_mancom boolean;
  _search_upper text;
BEGIN
  -- Get current user's email and roles
  _user_email := LOWER(auth.jwt() ->> 'email');
  _is_admin := has_role(auth.uid(), 'admin');
  
  SELECT is_department_head INTO _is_dept_head 
  FROM profiles WHERE id = auth.uid();
  
  SELECT is_mancom INTO _is_mancom 
  FROM profiles WHERE id = auth.uid();
  
  -- Get latest balance date
  SELECT MAX(as_of_date) INTO _latest_balance_date FROM balances_raw;
  
  -- Uppercase the search term for investor code matching
  _search_upper := UPPER(COALESCE(_search_term, ''));
  
  -- Count total matching records with filters and role-based access
  WITH accessible_clients AS (
    SELECT i.investor_code
    FROM investors i
    WHERE _is_admin = true
    UNION
    SELECT DISTINCT c.inv_code as investor_code
    FROM clients c
    WHERE 
      LOWER(c.rm_email) = _user_email
      OR (_is_dept_head = true AND is_department_head_of_rm(c.rm_email))
      OR (_is_mancom = true AND is_mancom_of_rm(c.rm_email))
  ),
  balance_agg AS (
    SELECT 
      br.investor_code,
      MAX(br.ledger_balance) as ledger_balance
    FROM balances_raw br
    WHERE br.as_of_date = _latest_balance_date
    GROUP BY br.investor_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    GROUP BY dw.investor_code
  ),
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
      AND COALESCE(th.value, 0) > 0
      -- Include trades with PF/FILL status OR trades with empty status but valid value
      AND (
        UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL') 
        OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL')
        OR (COALESCE(th.status, '') = '' AND COALESCE(th.fill_type, '') = '' AND COALESCE(th.value, 0) > 0)
      )
    GROUP BY th.client_code
  ),
  filtered_investors AS (
    SELECT i.investor_code
    FROM investors i
    INNER JOIN accessible_clients ac ON ac.investor_code = i.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = i.investor_code
    WHERE (_search_term IS NULL OR _search_term = '' OR 
           UPPER(i.investor_code) = _search_upper OR 
           LOWER(i.investor_name) LIKE '%' || LOWER(_search_term) || '%')
      AND (_account_type_filter = 'all' 
           OR (_account_type_filter = 'margin' AND LOWER(COALESCE(i.account_type, '')) = 'margin')
           OR (_account_type_filter = 'cash' AND LOWER(COALESCE(i.account_type, '')) != 'margin'))
      AND (_has_trades_filter = 'all'
           OR (_has_trades_filter = 'with_trades' AND (COALESCE(t.buy_sum, 0) > 0 OR COALESCE(t.sell_sum, 0) > 0))
           OR (_has_trades_filter = 'no_trades' AND COALESCE(t.buy_sum, 0) = 0 AND COALESCE(t.sell_sum, 0) = 0))
  )
  SELECT COUNT(*) INTO _total FROM filtered_investors;
  
  RETURN QUERY
  WITH accessible_clients AS (
    SELECT i.investor_code
    FROM investors i
    WHERE _is_admin = true
    UNION
    SELECT DISTINCT c.inv_code as investor_code
    FROM clients c
    WHERE 
      LOWER(c.rm_email) = _user_email
      OR (_is_dept_head = true AND is_department_head_of_rm(c.rm_email))
      OR (_is_mancom = true AND is_mancom_of_rm(c.rm_email))
  ),
  balance_agg AS (
    SELECT 
      br.investor_code,
      MAX(br.ledger_balance) as ledger_balance
    FROM balances_raw br
    WHERE br.as_of_date = _latest_balance_date
    GROUP BY br.investor_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    GROUP BY dw.investor_code
  ),
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
      AND COALESCE(th.value, 0) > 0
      -- Include trades with PF/FILL status OR trades with empty status but valid value
      AND (
        UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL') 
        OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL')
        OR (COALESCE(th.status, '') = '' AND COALESCE(th.fill_type, '') = '' AND COALESCE(th.value, 0) > 0)
      )
    GROUP BY th.client_code
  )
  SELECT 
    i.investor_code,
    i.investor_name,
    i.account_type,
    COALESCE(i.interest_rate, 0) as interest_rate,
    COALESCE(i.brokerage_commission, 0) as brokerage_commission,
    COALESCE(b.ledger_balance, 0) as ledger_balance,
    COALESCE(tx.deposits, 0) as total_deposits,
    COALESCE(tx.withdrawals, 0) as total_withdrawals,
    COALESCE(t.buy_sum, 0) as gross_buy,
    COALESCE(t.sell_sum, 0) as gross_sell,
    COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0) as net_sell,
    COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) as adjusted_ledger,
    CASE 
      WHEN LOWER(COALESCE(i.account_type, '')) = 'margin' 
           AND (COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0)) < 0
      THEN ABS(COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0)) * COALESCE(i.interest_rate, 0) / 365 / 100
      ELSE 0
    END as accrued_interest,
    (COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0) as brokerage_amount,
    COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
      + COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0) 
      - (COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0) as final_balance,
    GREATEST(0, COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0)) as receivable,
    GREATEST(0, COALESCE(t.buy_sum, 0) - COALESCE(t.sell_sum, 0)) as payable,
    _total as total_count
  FROM investors i
  INNER JOIN accessible_clients ac ON ac.investor_code = i.investor_code
  LEFT JOIN balance_agg b ON b.investor_code = i.investor_code
  LEFT JOIN tx_agg tx ON tx.investor_code = i.investor_code
  LEFT JOIN trade_agg t ON t.investor_code = i.investor_code
  WHERE (_search_term IS NULL OR _search_term = '' OR 
         UPPER(i.investor_code) = _search_upper OR 
         LOWER(i.investor_name) LIKE '%' || LOWER(_search_term) || '%')
    AND (_account_type_filter = 'all' 
         OR (_account_type_filter = 'margin' AND LOWER(COALESCE(i.account_type, '')) = 'margin')
         OR (_account_type_filter = 'cash' AND LOWER(COALESCE(i.account_type, '')) != 'margin'))
    AND (_has_trades_filter = 'all'
         OR (_has_trades_filter = 'with_trades' AND (COALESCE(t.buy_sum, 0) > 0 OR COALESCE(t.sell_sum, 0) > 0))
         OR (_has_trades_filter = 'no_trades' AND COALESCE(t.buy_sum, 0) = 0 AND COALESCE(t.sell_sum, 0) = 0))
  ORDER BY i.investor_code
  LIMIT _page_size
  OFFSET _page_offset;
END;
$function$;

-- Also update get_accounting_summary with same logic
CREATE OR REPLACE FUNCTION public.get_accounting_summary(_from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date date DEFAULT NULL::date, _to_tx_date date DEFAULT NULL::date, _account_type_filter text DEFAULT 'all'::text, _has_trades_filter text DEFAULT 'all'::text)
 RETURNS TABLE(total_accounts bigint, margin_accounts bigint, total_margin_loan numeric, total_accrued_interest numeric, total_buy numeric, total_sell numeric, total_trade_value numeric, total_receivable numeric, total_payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _latest_balance_date date;
  _user_email text;
  _is_admin boolean;
  _is_dept_head boolean;
  _is_mancom boolean;
BEGIN
  _user_email := LOWER(auth.jwt() ->> 'email');
  _is_admin := has_role(auth.uid(), 'admin');
  
  SELECT is_department_head INTO _is_dept_head 
  FROM profiles WHERE id = auth.uid();
  
  SELECT is_mancom INTO _is_mancom 
  FROM profiles WHERE id = auth.uid();
  
  SELECT MAX(as_of_date) INTO _latest_balance_date FROM balances_raw;
  
  RETURN QUERY
  WITH accessible_clients AS (
    SELECT i.investor_code
    FROM investors i
    WHERE _is_admin = true
    UNION
    SELECT DISTINCT c.inv_code as investor_code
    FROM clients c
    WHERE 
      LOWER(c.rm_email) = _user_email
      OR (_is_dept_head = true AND is_department_head_of_rm(c.rm_email))
      OR (_is_mancom = true AND is_mancom_of_rm(c.rm_email))
  ),
  balance_agg AS (
    SELECT 
      br.investor_code,
      MAX(br.ledger_balance) as ledger_balance
    FROM balances_raw br
    WHERE br.as_of_date = _latest_balance_date
    GROUP BY br.investor_code
  ),
  tx_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date)
    GROUP BY dw.investor_code
  ),
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
      AND COALESCE(th.value, 0) > 0
      -- Include trades with PF/FILL status OR trades with empty status but valid value
      AND (
        UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL') 
        OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL')
        OR (COALESCE(th.status, '') = '' AND COALESCE(th.fill_type, '') = '' AND COALESCE(th.value, 0) > 0)
      )
    GROUP BY th.client_code
  ),
  filtered_data AS (
    SELECT 
      i.investor_code,
      i.account_type,
      i.interest_rate,
      COALESCE(b.ledger_balance, 0) as ledger_balance,
      COALESCE(tx.deposits, 0) as deposits,
      COALESCE(tx.withdrawals, 0) as withdrawals,
      COALESCE(t.buy_sum, 0) as buy_sum,
      COALESCE(t.sell_sum, 0) as sell_sum
    FROM investors i
    INNER JOIN accessible_clients ac ON ac.investor_code = i.investor_code
    LEFT JOIN balance_agg b ON b.investor_code = i.investor_code
    LEFT JOIN tx_agg tx ON tx.investor_code = i.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = i.investor_code
    WHERE (_account_type_filter = 'all' 
           OR (_account_type_filter = 'margin' AND LOWER(COALESCE(i.account_type, '')) = 'margin')
           OR (_account_type_filter = 'cash' AND LOWER(COALESCE(i.account_type, '')) != 'margin'))
      AND (_has_trades_filter = 'all'
           OR (_has_trades_filter = 'with_trades' AND (COALESCE(t.buy_sum, 0) > 0 OR COALESCE(t.sell_sum, 0) > 0))
           OR (_has_trades_filter = 'no_trades' AND COALESCE(t.buy_sum, 0) = 0 AND COALESCE(t.sell_sum, 0) = 0))
  )
  SELECT 
    COUNT(*)::bigint as total_accounts,
    COUNT(*) FILTER (WHERE LOWER(COALESCE(account_type, '')) = 'margin')::bigint as margin_accounts,
    COALESCE(SUM(
      CASE 
        WHEN LOWER(COALESCE(account_type, '')) = 'margin' 
             AND (ledger_balance + deposits - withdrawals) < 0
        THEN ABS(ledger_balance + deposits - withdrawals)
        ELSE 0
      END
    ), 0) as total_margin_loan,
    COALESCE(SUM(
      CASE 
        WHEN LOWER(COALESCE(account_type, '')) = 'margin' 
             AND (ledger_balance + deposits - withdrawals) < 0
        THEN ABS(ledger_balance + deposits - withdrawals) * COALESCE(interest_rate, 0) / 365 / 100
        ELSE 0
      END
    ), 0) as total_accrued_interest,
    COALESCE(SUM(buy_sum), 0) as total_buy,
    COALESCE(SUM(sell_sum), 0) as total_sell,
    COALESCE(SUM(buy_sum + sell_sum), 0) as total_trade_value,
    COALESCE(SUM(GREATEST(0, sell_sum - buy_sum)), 0) as total_receivable,
    COALESCE(SUM(GREATEST(0, buy_sum - sell_sum)), 0) as total_payable
  FROM filtered_data;
END;
$function$;