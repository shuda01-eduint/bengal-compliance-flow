-- Drop existing function (return type is changing)
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, text, text, text, text);

-- Recreate with margin/non-margin breakdown fields
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL
)
RETURNS TABLE(
  total_accounts bigint,
  margin_accounts bigint,
  non_margin_accounts bigint,
  margin_percentage numeric,
  total_buy numeric,
  total_sell numeric,
  total_trade_value numeric,
  margin_buy numeric,
  non_margin_buy numeric,
  margin_sell numeric,
  non_margin_sell numeric,
  total_receivable numeric,
  total_payable numeric,
  margin_receivable numeric,
  non_margin_receivable numeric,
  margin_payable numeric,
  non_margin_payable numeric,
  total_accrued_interest numeric,
  total_margin_loan numeric,
  total_commission numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      ) as adjusted_ledger,
      -- Commission calculation
      ((fi.gross_buy + fi.gross_sell) * COALESCE(fi.brokerage_commission, 0)) as commission_amount,
      -- Is margin account?
      CASE WHEN UPPER(COALESCE(fi.account_type, '')) = 'MARGIN' THEN true ELSE false END as is_margin
    FROM filtered_investors fi
    LEFT JOIN combined_ledgers cl ON UPPER(cl.inv_code) = UPPER(fi.investor_code)
  )
  SELECT 
    COUNT(*)::BIGINT as total_accounts,
    COUNT(*) FILTER (WHERE is_margin = true)::BIGINT as margin_accounts,
    COUNT(*) FILTER (WHERE is_margin = false)::BIGINT as non_margin_accounts,
    CASE WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE is_margin = true)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      ELSE 0 
    END as margin_percentage,
    COALESCE(SUM(gross_buy), 0) as total_buy,
    COALESCE(SUM(gross_sell), 0) as total_sell,
    COALESCE(SUM(gross_buy + gross_sell), 0) as total_trade_value,
    -- Margin breakdown for buy
    COALESCE(SUM(gross_buy) FILTER (WHERE is_margin = true), 0) as margin_buy,
    COALESCE(SUM(gross_buy) FILTER (WHERE is_margin = false), 0) as non_margin_buy,
    -- Margin breakdown for sell
    COALESCE(SUM(gross_sell) FILTER (WHERE is_margin = true), 0) as margin_sell,
    COALESCE(SUM(gross_sell) FILTER (WHERE is_margin = false), 0) as non_margin_sell,
    -- Receivable/Payable totals
    COALESCE(SUM(GREATEST(0, adjusted_ledger)), 0) as total_receivable,
    COALESCE(SUM(GREATEST(0, -adjusted_ledger)), 0) as total_payable,
    -- Margin breakdown for receivable
    COALESCE(SUM(GREATEST(0, adjusted_ledger)) FILTER (WHERE is_margin = true), 0) as margin_receivable,
    COALESCE(SUM(GREATEST(0, adjusted_ledger)) FILTER (WHERE is_margin = false), 0) as non_margin_receivable,
    -- Margin breakdown for payable
    COALESCE(SUM(GREATEST(0, -adjusted_ledger)) FILTER (WHERE is_margin = true), 0) as margin_payable,
    COALESCE(SUM(GREATEST(0, -adjusted_ledger)) FILTER (WHERE is_margin = false), 0) as non_margin_payable,
    -- Accrued interest
    COALESCE(SUM(ledger_balance * COALESCE(interest_rate, 0) / 100 / 365 * 30), 0) as total_accrued_interest,
    -- Total margin loan (sum of negative adjusted ledgers for margin accounts)
    COALESCE(SUM(ABS(adjusted_ledger)) FILTER (WHERE is_margin = true AND adjusted_ledger < 0), 0) as total_margin_loan,
    -- Total commission
    COALESCE(SUM(commission_amount), 0) as total_commission
  FROM computed;
END;
$$;