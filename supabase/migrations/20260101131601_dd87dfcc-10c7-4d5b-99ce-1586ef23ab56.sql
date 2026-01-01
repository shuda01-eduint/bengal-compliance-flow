-- Drop and recreate get_accounting_data with sorting support
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL::text, 
  _account_type_filter text DEFAULT NULL::text, 
  _has_trades_filter text DEFAULT NULL::text, 
  _from_trade_date text DEFAULT NULL::text, 
  _to_trade_date text DEFAULT NULL::text, 
  _from_tx_date text DEFAULT NULL::text, 
  _to_tx_date text DEFAULT NULL::text, 
  _page_size integer DEFAULT 50, 
  _page_offset integer DEFAULT 0,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc'
)
RETURNS TABLE(
  investor_code text, 
  investor_name text, 
  account_type text, 
  brokerage_commission numeric, 
  interest_rate numeric, 
  ledger_balance numeric, 
  gross_buy numeric, 
  gross_sell numeric, 
  net_buy numeric, 
  net_sell numeric, 
  brokerage_amount numeric, 
  accrued_interest numeric, 
  adjusted_ledger numeric, 
  receivable numeric, 
  payable numeric, 
  final_balance numeric, 
  total_deposits numeric, 
  total_withdrawals numeric, 
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- FIX: Use < instead of <= to get EOD from the day BEFORE the start date
  IF _from_tx_date IS NOT NULL THEN
    SELECT MAX(eod_date) INTO eod_date_to_use
    FROM eod_ledger_snapshots
    WHERE eod_date < _from_tx_date::DATE;
  END IF;
  
  IF eod_date_to_use IS NULL THEN
    eod_date_to_use := CURRENT_DATE;
  END IF;

  -- Convert transaction dates to trade_history format (yyyyMMdd)
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
      i.investor_name,
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
  calculated AS (
    SELECT 
      fi.investor_code,
      fi.investor_name,
      fi.account_type,
      fi.brokerage_commission,
      fi.interest_rate,
      COALESCE(cl.ledger_balance, 0) as ledger_balance,
      fi.gross_buy,
      fi.gross_sell,
      (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0))) as net_buy,
      (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0))) as net_sell,
      ((fi.gross_buy + fi.gross_sell) * COALESCE(fi.brokerage_commission, 0)) as brokerage_amount,
      (COALESCE(cl.ledger_balance, 0) * COALESCE(fi.interest_rate, 0) / 100 / 365 * 30) as accrued_interest,
      (COALESCE(cl.ledger_balance, 0) 
        - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
        + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
        + fi.total_deposits 
        - fi.total_withdrawals
      ) as adjusted_ledger,
      GREATEST(0, 
        COALESCE(cl.ledger_balance, 0) 
        - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
        + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
        + fi.total_deposits 
        - fi.total_withdrawals
      ) as receivable,
      GREATEST(0, -(
        COALESCE(cl.ledger_balance, 0) 
        - (fi.gross_buy + (fi.gross_buy * COALESCE(fi.brokerage_commission, 0)))
        + (fi.gross_sell - (fi.gross_sell * COALESCE(fi.brokerage_commission, 0)))
        + fi.total_deposits 
        - fi.total_withdrawals
      )) as payable,
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
    LEFT JOIN combined_ledgers cl ON UPPER(cl.inv_code) = UPPER(fi.investor_code)
  )
  SELECT * FROM calculated
  ORDER BY 
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN calculated.investor_code
        WHEN 'investor_name' THEN calculated.investor_name
        WHEN 'account_type' THEN calculated.account_type
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN calculated.investor_code
        WHEN 'investor_name' THEN calculated.investor_name
        WHEN 'account_type' THEN calculated.account_type
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN calculated.ledger_balance
        WHEN 'gross_buy' THEN calculated.gross_buy
        WHEN 'gross_sell' THEN calculated.gross_sell
        WHEN 'net_buy' THEN calculated.net_buy
        WHEN 'net_sell' THEN calculated.net_sell
        WHEN 'brokerage_amount' THEN calculated.brokerage_amount
        WHEN 'accrued_interest' THEN calculated.accrued_interest
        WHEN 'adjusted_ledger' THEN calculated.adjusted_ledger
        WHEN 'receivable' THEN calculated.receivable
        WHEN 'payable' THEN calculated.payable
        WHEN 'final_balance' THEN calculated.final_balance
        WHEN 'total_deposits' THEN calculated.total_deposits
        WHEN 'total_withdrawals' THEN calculated.total_withdrawals
        WHEN 'interest_rate' THEN calculated.interest_rate
        WHEN 'brokerage_commission' THEN calculated.brokerage_commission
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN calculated.ledger_balance
        WHEN 'gross_buy' THEN calculated.gross_buy
        WHEN 'gross_sell' THEN calculated.gross_sell
        WHEN 'net_buy' THEN calculated.net_buy
        WHEN 'net_sell' THEN calculated.net_sell
        WHEN 'brokerage_amount' THEN calculated.brokerage_amount
        WHEN 'accrued_interest' THEN calculated.accrued_interest
        WHEN 'adjusted_ledger' THEN calculated.adjusted_ledger
        WHEN 'receivable' THEN calculated.receivable
        WHEN 'payable' THEN calculated.payable
        WHEN 'final_balance' THEN calculated.final_balance
        WHEN 'total_deposits' THEN calculated.total_deposits
        WHEN 'total_withdrawals' THEN calculated.total_withdrawals
        WHEN 'interest_rate' THEN calculated.interest_rate
        WHEN 'brokerage_commission' THEN calculated.brokerage_commission
      END
    END DESC NULLS LAST,
    calculated.investor_code ASC
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;