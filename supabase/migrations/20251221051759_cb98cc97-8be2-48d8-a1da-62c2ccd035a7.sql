
-- Drop existing function first since return type is changing
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, text, text, integer, integer);

-- Recreate get_accounting_data function with correct Net Buy and Final Balance calculations
CREATE FUNCTION public.get_accounting_data(_search_term text DEFAULT NULL::text, _account_type_filter text DEFAULT NULL::text, _has_trades_filter text DEFAULT NULL::text, _from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date text DEFAULT NULL::text, _to_tx_date text DEFAULT NULL::text, _page_size integer DEFAULT 50, _page_offset integer DEFAULT 0)
 RETURNS TABLE(investor_code text, investor_name text, account_type text, brokerage_commission numeric, interest_rate numeric, ledger_balance numeric, gross_buy numeric, gross_sell numeric, net_buy numeric, net_sell numeric, brokerage_amount numeric, accrued_interest numeric, adjusted_ledger numeric, receivable numeric, payable numeric, final_balance numeric, total_deposits numeric, total_withdrawals numeric, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin BOOLEAN;
  user_email TEXT;
  is_dept_head BOOLEAN;
  is_mancom_member BOOLEAN;
BEGIN
  SELECT has_role(auth.uid(), 'admin') INTO is_admin;
  SELECT auth.jwt() ->> 'email' INTO user_email;
  
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND is_department_head = true 
    AND is_approved = true
  ) INTO is_dept_head;
  
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND is_mancom = true 
    AND is_approved = true
  ) INTO is_mancom_member;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT 
      dw.investor_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::DATE)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::DATE)
    GROUP BY dw.investor_code
  ),
  filtered_investors AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.brokerage_commission,
      i.interest_rate,
      COALESCE(ts.buy_sum, 0) as gross_buy,
      COALESCE(ts.sell_sum, 0) as gross_sell,
      COALESCE(ds.deposits, 0) as total_deposits,
      COALESCE(ds.withdrawals, 0) as total_withdrawals
    FROM investors i
    LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
    LEFT JOIN deposit_sums ds ON ds.inv_code = i.investor_code
    WHERE (_search_term IS NULL 
      OR i.investor_code ILIKE '%' || _search_term || '%'
      OR i.investor_name ILIKE '%' || _search_term || '%')
    AND (_account_type_filter IS NULL 
      OR _account_type_filter = 'all'
      OR UPPER(COALESCE(i.account_type, '')) = UPPER(_account_type_filter))
    AND (_has_trades_filter IS NULL
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_trades' AND (COALESCE(ts.buy_sum, 0) > 0 OR COALESCE(ts.sell_sum, 0) > 0))
      OR (_has_trades_filter = 'without_trades' AND COALESCE(ts.buy_sum, 0) = 0 AND COALESCE(ts.sell_sum, 0) = 0))
    AND (is_admin = true
      OR is_dept_head = true
      OR is_mancom_member = true
      OR EXISTS (
        SELECT 1 FROM investor_rm_assignments ira
        WHERE ira.investor_code = i.investor_code
        AND LOWER(ira.rm_email) = LOWER(user_email)
      ))
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM filtered_investors
  ),
  client_ledgers AS (
    SELECT c.inv_code, c.ledger_balance FROM clients c
  )
  SELECT 
    fi.investor_code,
    fi.investor_name,
    fi.account_type,
    fi.brokerage_commission,
    fi.interest_rate,
    COALESCE(cl.ledger_balance, 0) as ledger_balance,
    fi.gross_buy,
    fi.gross_sell,
    -- Net Buy = Gross Buy + (Gross Buy × Brokerage Commission)
    (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0))) as net_buy,
    -- Net Sell = Gross Sell - (Gross Sell × Brokerage Commission)
    (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0))) as net_sell,
    -- Total Brokerage = (Gross Buy + Gross Sell) × Brokerage Commission
    ((fi.gross_buy + fi.gross_sell) * COALESCE(fi.brokerage_commission, 0)) as brokerage_amount,
    -- Accrued Interest
    (COALESCE(cl.ledger_balance, 0) * COALESCE(fi.interest_rate, 0) / 100 / 365 * 30) as accrued_interest,
    -- Adjusted Ledger = Ledger Balance - Net Buy + Net Sell + Deposits - Withdrawals
    (COALESCE(cl.ledger_balance, 0) 
      - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
      + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
      + fi.total_deposits 
      - fi.total_withdrawals
    ) as adjusted_ledger,
    -- Receivable = MAX(0, adjusted_ledger)
    GREATEST(0, 
      COALESCE(cl.ledger_balance, 0) 
      - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
      + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
      + fi.total_deposits 
      - fi.total_withdrawals
    ) as receivable,
    -- Payable = MAX(0, -adjusted_ledger)
    GREATEST(0, -(
      COALESCE(cl.ledger_balance, 0) 
      - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
      + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
      + fi.total_deposits 
      - fi.total_withdrawals
    )) as payable,
    -- Final Balance = Ledger Balance - Net Buy + Net Sell + Deposits - Withdrawals
    (COALESCE(cl.ledger_balance, 0) 
      - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
      + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
      + fi.total_deposits 
      - fi.total_withdrawals
    ) as final_balance,
    fi.total_deposits,
    fi.total_withdrawals,
    (SELECT cnt FROM counted) as total_count
  FROM filtered_investors fi
  LEFT JOIN client_ledgers cl ON cl.inv_code = fi.investor_code
  ORDER BY fi.investor_code
  LIMIT _page_size
  OFFSET _page_offset;
END;
$function$;

-- Update get_accounting_summary function for consistency
CREATE OR REPLACE FUNCTION public.get_accounting_summary(_account_type_filter text DEFAULT NULL::text, _has_trades_filter text DEFAULT NULL::text, _from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date text DEFAULT NULL::text, _to_tx_date text DEFAULT NULL::text)
 RETURNS TABLE(total_accounts bigint, margin_accounts bigint, total_buy numeric, total_sell numeric, total_trade_value numeric, total_receivable numeric, total_payable numeric, total_accrued_interest numeric, total_margin_loan numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin BOOLEAN;
  user_email TEXT;
  is_dept_head BOOLEAN;
  is_mancom_member BOOLEAN;
BEGIN
  SELECT has_role(auth.uid(), 'admin') INTO is_admin;
  SELECT auth.jwt() ->> 'email' INTO user_email;
  
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND is_department_head = true 
    AND is_approved = true
  ) INTO is_dept_head;
  
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND is_mancom = true 
    AND is_approved = true
  ) INTO is_mancom_member;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
      AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT 
      dw.investor_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx_date IS NULL OR dw.transaction_date >= _from_tx_date::DATE)
      AND (_to_tx_date IS NULL OR dw.transaction_date <= _to_tx_date::DATE)
    GROUP BY dw.investor_code
  ),
  filtered_investors AS (
    SELECT 
      i.investor_code,
      i.account_type,
      i.brokerage_commission,
      i.interest_rate,
      COALESCE(ts.buy_sum, 0) as gross_buy,
      COALESCE(ts.sell_sum, 0) as gross_sell,
      COALESCE(ds.deposits, 0) as total_deposits,
      COALESCE(ds.withdrawals, 0) as total_withdrawals
    FROM investors i
    LEFT JOIN trade_sums ts ON ts.client_code = i.investor_code
    LEFT JOIN deposit_sums ds ON ds.inv_code = i.investor_code
    WHERE (_account_type_filter IS NULL 
      OR _account_type_filter = 'all'
      OR UPPER(COALESCE(i.account_type, '')) = UPPER(_account_type_filter))
    AND (_has_trades_filter IS NULL
      OR _has_trades_filter = 'all'
      OR (_has_trades_filter = 'with_trades' AND (COALESCE(ts.buy_sum, 0) > 0 OR COALESCE(ts.sell_sum, 0) > 0))
      OR (_has_trades_filter = 'without_trades' AND COALESCE(ts.buy_sum, 0) = 0 AND COALESCE(ts.sell_sum, 0) = 0))
    AND (is_admin = true
      OR is_dept_head = true
      OR is_mancom_member = true
      OR EXISTS (
        SELECT 1 FROM investor_rm_assignments ira
        WHERE ira.investor_code = i.investor_code
        AND LOWER(ira.rm_email) = LOWER(user_email)
      ))
  ),
  client_ledgers AS (
    SELECT c.inv_code, c.ledger_balance FROM clients c
  ),
  computed AS (
    SELECT 
      fi.investor_code,
      fi.account_type,
      fi.gross_buy,
      fi.gross_sell,
      fi.total_deposits,
      fi.total_withdrawals,
      COALESCE(cl.ledger_balance, 0) as ledger_balance,
      fi.interest_rate,
      fi.brokerage_commission,
      -- Adjusted Ledger = Ledger Balance - Net Buy + Net Sell + Deposits - Withdrawals
      (COALESCE(cl.ledger_balance, 0) 
        - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
        + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
        + fi.total_deposits 
        - fi.total_withdrawals
      ) as adjusted_ledger
    FROM filtered_investors fi
    LEFT JOIN client_ledgers cl ON cl.inv_code = fi.investor_code
  )
  SELECT 
    COUNT(*)::BIGINT as total_accounts,
    COUNT(*) FILTER (WHERE UPPER(COALESCE(account_type, '')) = 'MARGIN')::BIGINT as margin_accounts,
    COALESCE(SUM(gross_buy), 0) as total_buy,
    COALESCE(SUM(gross_sell), 0) as total_sell,
    COALESCE(SUM(gross_buy + gross_sell), 0) as total_trade_value,
    COALESCE(SUM(GREATEST(0, adjusted_ledger)), 0) as total_receivable,
    COALESCE(SUM(GREATEST(0, -adjusted_ledger)), 0) as total_payable,
    COALESCE(SUM(ledger_balance * COALESCE(interest_rate, 0) / 100 / 365 * 30), 0) as total_accrued_interest,
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(account_type, '')) = 'MARGIN' AND ledger_balance < 0 THEN ABS(ledger_balance) ELSE 0 END), 0) as total_margin_loan
  FROM computed;
END;
$function$;
