-- 1. Add RLS policy to investors table for approved users to view
CREATE POLICY "Approved users can view investors"
ON public.investors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_approved = true
  )
);

-- 2. Fix get_accounting_summary function - use < instead of <= for EOD date lookup
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
  eod_date_to_use DATE;
  trade_from_date TEXT;
  trade_to_date TEXT;
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

  -- FIX: Use < instead of <= to get EOD from the day BEFORE the start date
  IF _from_tx_date IS NOT NULL THEN
    SELECT MAX(eod_date) INTO eod_date_to_use
    FROM eod_ledger_snapshots
    WHERE eod_date < _from_tx_date::DATE;
  END IF;
  
  IF eod_date_to_use IS NULL THEN
    eod_date_to_use := CURRENT_DATE;
  END IF;

  IF _from_tx_date IS NOT NULL THEN
    trade_from_date := to_char(_from_tx_date::DATE, 'YYYYMMDD');
  ELSIF _from_trade_date IS NOT NULL THEN
    trade_from_date := _from_trade_date;
  END IF;
  
  IF _to_tx_date IS NOT NULL THEN
    trade_to_date := to_char(_to_tx_date::DATE, 'YYYYMMDD');
  ELSIF _to_trade_date IS NOT NULL THEN
    trade_to_date := _to_trade_date;
  END IF;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF') OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF'))
      AND (trade_from_date IS NULL OR th.trade_date >= trade_from_date)
      AND (trade_to_date IS NULL OR th.trade_date <= trade_to_date)
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
  eod_ledgers AS (
    SELECT 
      els.investor_code as inv_code,
      els.ledger_balance
    FROM eod_ledger_snapshots els
    WHERE els.eod_date = eod_date_to_use
  ),
  client_ledgers AS (
    SELECT c.inv_code, c.ledger_balance FROM clients c
  ),
  combined_ledgers AS (
    SELECT 
      COALESCE(els.inv_code, cl.inv_code) as inv_code,
      COALESCE(els.ledger_balance, cl.ledger_balance, 0) as ledger_balance
    FROM client_ledgers cl
    FULL OUTER JOIN eod_ledgers els ON UPPER(els.inv_code) = UPPER(cl.inv_code)
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
    LEFT JOIN trade_sums ts ON UPPER(ts.client_code) = UPPER(i.investor_code)
    LEFT JOIN deposit_sums ds ON UPPER(ds.inv_code) = UPPER(i.investor_code)
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
      (COALESCE(cl.ledger_balance, 0) 
        - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
        + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
        + fi.total_deposits 
        - fi.total_withdrawals
      ) as adjusted_ledger
    FROM filtered_investors fi
    LEFT JOIN combined_ledgers cl ON UPPER(cl.inv_code) = UPPER(fi.investor_code)
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