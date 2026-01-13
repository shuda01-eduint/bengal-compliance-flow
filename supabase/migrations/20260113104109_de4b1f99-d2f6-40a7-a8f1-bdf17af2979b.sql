
CREATE OR REPLACE FUNCTION get_negative_balance_codes(
  _from_date text DEFAULT NULL,
  _to_date text DEFAULT NULL,
  _search text DEFAULT '',
  _limit integer DEFAULT 1000,
  _offset integer DEFAULT 0
) RETURNS TABLE (
  event_date date,
  client_code text,
  client_name text,
  instrument text,
  amount numeric,
  last_day integer,
  event_day integer,
  rm_name text
) LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  from_dt date;
  to_dt date;
BEGIN
  -- Parse dates
  from_dt := CASE WHEN _from_date IS NOT NULL AND _from_date != '' THEN _from_date::date ELSE CURRENT_DATE - INTERVAL '30 days' END;
  to_dt := CASE WHEN _to_date IS NOT NULL AND _to_date != '' THEN _to_date::date ELSE CURRENT_DATE END;

  RETURN QUERY
  WITH trade_summary AS (
    SELECT 
      th.investor_code,
      th.trade_date,
      th.instrument_name,
      SUM(CASE WHEN LOWER(th.side) = 'sell' THEN th.net_amount ELSE 0 END) as sell_value,
      SUM(CASE WHEN LOWER(th.side) = 'buy' THEN th.net_amount ELSE 0 END) as buy_value
    FROM trade_history th
    WHERE th.trade_date BETWEEN from_dt AND to_dt
    GROUP BY th.investor_code, th.trade_date, th.instrument_name
  ),
  dw_summary AS (
    SELECT 
      dw.investor_code,
      dw.transaction_date,
      SUM(CASE WHEN LOWER(dw.type) = 'deposit' THEN dw.amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(dw.type) = 'withdrawal' THEN dw.amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date BETWEEN from_dt AND to_dt
    GROUP BY dw.investor_code, dw.transaction_date
  ),
  combined_events AS (
    -- Trade events
    SELECT 
      ts.investor_code,
      ts.trade_date as event_dt,
      ts.instrument_name as instr,
      COALESCE(c.ledger_balance, 0) + COALESCE(ts.sell_value, 0) - COALESCE(ts.buy_value, 0) as closing_bal,
      'trade' as event_type
    FROM trade_summary ts
    LEFT JOIN clients c ON c.investor_code = ts.investor_code
    
    UNION ALL
    
    -- Deposit/Withdrawal events
    SELECT 
      dw.investor_code,
      dw.transaction_date as event_dt,
      'NA'::text as instr,
      COALESCE(c.ledger_balance, 0) + COALESCE(dw.deposits, 0) - COALESCE(dw.withdrawals, 0) as closing_bal,
      'dw' as event_type
    FROM dw_summary dw
    LEFT JOIN clients c ON c.investor_code = dw.investor_code
  ),
  negative_balances AS (
    SELECT 
      ce.investor_code,
      ce.event_dt,
      ce.instr,
      ce.closing_bal,
      i.investor_name,
      COALESCE(c.rm_name, i.rm_name, '') as rm,
      -- Calculate days since event
      (CURRENT_DATE - ce.event_dt)::integer as days_since
    FROM combined_events ce
    LEFT JOIN investors i ON i.investor_code = ce.investor_code
    LEFT JOIN clients c ON c.investor_code = ce.investor_code
    WHERE ce.closing_bal < 0
  )
  SELECT 
    nb.event_dt as event_date,
    nb.investor_code as client_code,
    COALESCE(nb.investor_name, '') as client_name,
    COALESCE(nb.instr, 'NA') as instrument,
    nb.closing_bal as amount,
    nb.days_since as last_day,
    nb.days_since as event_day,
    nb.rm as rm_name
  FROM negative_balances nb
  WHERE (
    _search = '' 
    OR nb.investor_code ILIKE '%' || _search || '%'
    OR nb.investor_name ILIKE '%' || _search || '%'
    OR nb.rm ILIKE '%' || _search || '%'
  )
  ORDER BY nb.closing_bal ASC, nb.event_dt DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;
