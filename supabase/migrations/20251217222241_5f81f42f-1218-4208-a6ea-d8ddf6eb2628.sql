
-- Update get_accounting_data to calculate receivable as closing balance including accrued interest
CREATE OR REPLACE FUNCTION public.get_accounting_data(_search_term text DEFAULT NULL::text, _from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date date DEFAULT NULL::date, _to_tx_date date DEFAULT NULL::date, _page_size integer DEFAULT 50, _page_offset integer DEFAULT 0)
 RETURNS TABLE(investor_code text, investor_name text, account_type text, interest_rate numeric, brokerage_commission numeric, ledger_balance numeric, total_deposits numeric, total_withdrawals numeric, gross_buy numeric, gross_sell numeric, net_sell numeric, adjusted_ledger numeric, accrued_interest numeric, brokerage_amount numeric, final_balance numeric, receivable numeric, payable numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _total bigint;
  _latest_balance_date date;
BEGIN
  -- Get latest balance date
  SELECT MAX(as_of_date) INTO _latest_balance_date FROM balances_raw;
  
  -- Count total matching records
  SELECT COUNT(DISTINCT i.investor_code) INTO _total
  FROM investors i
  WHERE (_search_term IS NULL OR _search_term = '' OR 
         i.investor_code = _search_term OR 
         LOWER(i.investor_name) LIKE '%' || LOWER(_search_term) || '%');
  
  RETURN QUERY
  WITH balance_agg AS (
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
      AND (UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL') OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL'))
    GROUP BY th.client_code
  ),
  computed AS (
    SELECT 
      i.investor_code,
      COALESCE(i.investor_name, c.investor_name, '') as investor_name,
      COALESCE(i.account_type, '') as account_type,
      COALESCE(i.interest_rate, 0) as interest_rate,
      COALESCE(i.brokerage_commission, 0) as brokerage_commission,
      COALESCE(b.ledger_balance, 0) as ledger_balance,
      COALESCE(tx.deposits, 0) as total_deposits,
      COALESCE(tx.withdrawals, 0) as total_withdrawals,
      COALESCE(t.buy_sum, 0) as gross_buy,
      COALESCE(t.sell_sum, 0) as gross_sell,
      (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0)) as net_sell,
      (COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) as adjusted_ledger,
      -- Brokerage amount
      ((COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0)) as brokerage_amount,
      -- Accrued interest for margin accounts with negative adjusted ledger
      CASE 
        WHEN LOWER(COALESCE(i.account_type, '')) = 'margin' 
             AND (COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) < 0
        THEN (COALESCE(i.interest_rate, 0) / 365) * ABS(COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) / 100
        ELSE 0
      END as accrued_interest
    FROM investors i
    LEFT JOIN clients c ON c.inv_code = i.investor_code
    LEFT JOIN balance_agg b ON b.investor_code = i.investor_code
    LEFT JOIN tx_agg tx ON tx.investor_code = i.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = i.investor_code
    WHERE (_search_term IS NULL OR _search_term = '' OR 
           i.investor_code = _search_term OR 
           LOWER(i.investor_name) LIKE '%' || LOWER(_search_term) || '%')
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
    c.net_sell,
    c.adjusted_ledger,
    c.accrued_interest,
    c.brokerage_amount,
    -- Final balance (without accrued interest)
    (c.ledger_balance + c.total_deposits - c.total_withdrawals + c.gross_sell - c.gross_buy - c.brokerage_amount) as final_balance,
    -- Receivable = Closing Balance = Ledger + Deposits - Withdrawals + Sell - Buy - Brokerage - Accrued Interest
    (c.ledger_balance + c.total_deposits - c.total_withdrawals + c.gross_sell - c.gross_buy - c.brokerage_amount - c.accrued_interest) as receivable,
    -- Payable (negative closing balance as positive, kept for reference)
    GREATEST(0, -(c.ledger_balance + c.total_deposits - c.total_withdrawals + c.gross_sell - c.gross_buy - c.brokerage_amount - c.accrued_interest)) as payable,
    _total as total_count
  FROM computed c
  ORDER BY c.investor_code
  LIMIT _page_size
  OFFSET _page_offset;
END;
$function$;

-- Update get_accounting_summary to include accrued interest in receivable calculation
CREATE OR REPLACE FUNCTION public.get_accounting_summary(_from_trade_date text DEFAULT NULL::text, _to_trade_date text DEFAULT NULL::text, _from_tx_date date DEFAULT NULL::date, _to_tx_date date DEFAULT NULL::date)
 RETURNS TABLE(total_accounts bigint, margin_accounts bigint, total_margin_loan numeric, total_accrued_interest numeric, total_receivable numeric, total_payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _latest_balance_date date;
BEGIN
  -- Get latest balance date
  SELECT MAX(as_of_date) INTO _latest_balance_date FROM balances_raw;
  
  RETURN QUERY
  WITH balance_agg AS (
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
      AND (UPPER(COALESCE(th.status, '')) IN ('PF', 'FILL') OR UPPER(COALESCE(th.fill_type, '')) IN ('PF', 'FILL'))
    GROUP BY th.client_code
  ),
  computed AS (
    SELECT 
      i.investor_code,
      i.account_type,
      i.interest_rate,
      i.brokerage_commission,
      COALESCE(b.ledger_balance, 0) as ledger_balance,
      COALESCE(tx.deposits, 0) as deposits,
      COALESCE(tx.withdrawals, 0) as withdrawals,
      COALESCE(t.buy_sum, 0) as buy_sum,
      COALESCE(t.sell_sum, 0) as sell_sum,
      (COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) as adjusted_ledger,
      ((COALESCE(t.buy_sum, 0) + COALESCE(t.sell_sum, 0)) * COALESCE(i.brokerage_commission, 0)) as brokerage_amount,
      CASE 
        WHEN LOWER(COALESCE(i.account_type, '')) = 'margin' 
             AND (COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) < 0
        THEN (COALESCE(i.interest_rate, 0) / 365) * ABS(COALESCE(b.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) + (COALESCE(t.sell_sum, 0) - COALESCE(t.buy_sum, 0))) / 100
        ELSE 0
      END as accrued_interest
    FROM investors i
    LEFT JOIN balance_agg b ON b.investor_code = i.investor_code
    LEFT JOIN tx_agg tx ON tx.investor_code = i.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = i.investor_code
  ),
  with_closing AS (
    SELECT 
      c.*,
      -- Closing Balance = Ledger + Deposits - Withdrawals + Sell - Buy - Brokerage - Accrued Interest
      (c.ledger_balance + c.deposits - c.withdrawals + c.sell_sum - c.buy_sum - c.brokerage_amount - c.accrued_interest) as closing_balance
    FROM computed c
  )
  SELECT 
    COUNT(*)::bigint as total_accounts,
    COUNT(*) FILTER (WHERE LOWER(COALESCE(account_type, '')) = 'margin')::bigint as margin_accounts,
    COALESCE(SUM(ABS(adjusted_ledger)) FILTER (WHERE LOWER(COALESCE(account_type, '')) = 'margin' AND adjusted_ledger < 0), 0) as total_margin_loan,
    COALESCE(SUM(accrued_interest), 0) as total_accrued_interest,
    -- Total Receivable = sum of positive closing balances
    COALESCE(SUM(closing_balance) FILTER (WHERE closing_balance > 0), 0) as total_receivable,
    -- Total Payable = sum of absolute value of negative closing balances
    COALESCE(SUM(ABS(closing_balance)) FILTER (WHERE closing_balance < 0), 0) as total_payable
  FROM with_closing;
END;
$function$;
