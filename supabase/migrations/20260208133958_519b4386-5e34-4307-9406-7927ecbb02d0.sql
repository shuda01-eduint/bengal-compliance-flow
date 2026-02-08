-- View: v_ledger_dashboard - Daily aggregates from EOD snapshots
CREATE OR REPLACE VIEW public.v_ledger_dashboard AS
SELECT 
  eod_date,
  COALESCE(SUM(total_deposits), 0) + COALESCE(SUM(gross_sell), 0) as total_credit,
  COALESCE(SUM(total_withdrawals), 0) + COALESCE(SUM(gross_buy), 0) + COALESCE(SUM(total_commission), 0) as total_debit,
  (COALESCE(SUM(total_deposits), 0) + COALESCE(SUM(gross_sell), 0)) - 
  (COALESCE(SUM(total_withdrawals), 0) + COALESCE(SUM(gross_buy), 0) + COALESCE(SUM(total_commission), 0)) as net_balance,
  COUNT(DISTINCT investor_code) as client_count
FROM eod_ledger_snapshots
GROUP BY eod_date;

-- RPC: get_ledger_by_date - Returns investor ledger entries for a specific date
CREATE OR REPLACE FUNCTION public.get_ledger_by_date(
  _eod_date date,
  _search text DEFAULT NULL,
  _limit int DEFAULT 500
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  department text,
  total_deposits numeric,
  total_withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  total_commission numeric,
  opening_balance numeric,
  closing_balance numeric,
  total_debit numeric,
  total_credit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    els.investor_code,
    els.investor_name,
    els.account_type,
    els.rm_name,
    els.department,
    COALESCE(els.total_deposits, 0) as total_deposits,
    COALESCE(els.total_withdrawals, 0) as total_withdrawals,
    COALESCE(els.gross_buy, 0) as gross_buy,
    COALESCE(els.gross_sell, 0) as gross_sell,
    COALESCE(els.total_commission, 0) as total_commission,
    COALESCE(els.opening_balance, 0) as opening_balance,
    COALESCE(els.closing_balance, 0) as closing_balance,
    (COALESCE(els.total_withdrawals, 0) + COALESCE(els.gross_buy, 0) + COALESCE(els.total_commission, 0)) as total_debit,
    (COALESCE(els.total_deposits, 0) + COALESCE(els.gross_sell, 0)) as total_credit
  FROM eod_ledger_snapshots els
  WHERE els.eod_date = _eod_date
    AND (
      _search IS NULL 
      OR _search = ''
      OR els.investor_code ILIKE '%' || _search || '%'
      OR els.investor_name ILIKE '%' || _search || '%'
    )
  ORDER BY els.investor_code
  LIMIT _limit;
END;
$$;

-- RPC: get_investor_ledger - Returns detailed transactions for an investor in a date range
CREATE OR REPLACE FUNCTION public.get_investor_ledger(
  _investor_code text,
  _from_date date,
  _to_date date
)
RETURNS TABLE (
  txn_date date,
  entry_type text,
  scrip_name text,
  qty integer,
  rate numeric,
  trade_value numeric,
  commission numeric,
  debit numeric,
  credit numeric,
  running_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return trades and deposits/withdrawals combined as ledger entries
  RETURN QUERY
  WITH ledger_entries AS (
    -- Trades (Buy = Debit, Sell = Credit)
    SELECT 
      th.trade_date as txn_date,
      CASE WHEN th.buy_sell = 'B' THEN 'BUY' ELSE 'SELL' END as entry_type,
      th.scrip_name,
      th.quantity::integer as qty,
      th.price as rate,
      th.trade_value,
      th.commission,
      CASE WHEN th.buy_sell = 'B' THEN th.trade_value + COALESCE(th.commission, 0) ELSE 0 END as debit,
      CASE WHEN th.buy_sell = 'S' THEN th.trade_value - COALESCE(th.commission, 0) ELSE 0 END as credit
    FROM trade_history th
    WHERE th.investor_code = _investor_code
      AND th.trade_date BETWEEN _from_date AND _to_date
    
    UNION ALL
    
    -- Deposits (Credit)
    SELECT 
      dw.transaction_date as txn_date,
      'DEPOSIT' as entry_type,
      NULL as scrip_name,
      NULL as qty,
      NULL as rate,
      dw.amount as trade_value,
      0 as commission,
      0 as debit,
      dw.amount as credit
    FROM deposits_withdrawals dw
    WHERE dw.investor_code = _investor_code
      AND dw.transaction_type = 'DEPOSIT'
      AND dw.transaction_date BETWEEN _from_date AND _to_date
    
    UNION ALL
    
    -- Withdrawals (Debit)
    SELECT 
      dw.transaction_date as txn_date,
      'WITHDRAWAL' as entry_type,
      NULL as scrip_name,
      NULL as qty,
      NULL as rate,
      dw.amount as trade_value,
      0 as commission,
      dw.amount as debit,
      0 as credit
    FROM deposits_withdrawals dw
    WHERE dw.investor_code = _investor_code
      AND dw.transaction_type = 'WITHDRAWAL'
      AND dw.transaction_date BETWEEN _from_date AND _to_date
  ),
  ordered_entries AS (
    SELECT 
      le.*,
      SUM(le.credit - le.debit) OVER (ORDER BY le.txn_date, le.entry_type) as running_balance
    FROM ledger_entries le
  )
  SELECT 
    oe.txn_date,
    oe.entry_type,
    oe.scrip_name,
    oe.qty,
    oe.rate,
    oe.trade_value,
    oe.commission,
    oe.debit,
    oe.credit,
    oe.running_balance
  FROM ordered_entries oe
  ORDER BY oe.txn_date, oe.entry_type;
END;
$$;

-- RPC: get_investor_daily_balances - Returns daily closing balances for chart
CREATE OR REPLACE FUNCTION public.get_investor_daily_balances(
  _investor_code text,
  _from_date date,
  _to_date date
)
RETURNS TABLE (
  balance_date date,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    els.eod_date as balance_date,
    COALESCE(els.closing_balance, els.ledger_balance) as closing_balance
  FROM eod_ledger_snapshots els
  WHERE els.investor_code = _investor_code
    AND els.eod_date BETWEEN _from_date AND _to_date
  ORDER BY els.eod_date;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_ledger_by_date(date, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_ledger(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_daily_balances(text, date, date) TO authenticated;