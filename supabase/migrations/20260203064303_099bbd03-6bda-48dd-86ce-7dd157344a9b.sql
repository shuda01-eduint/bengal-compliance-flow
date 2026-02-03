CREATE OR REPLACE FUNCTION public.get_over_buy_margin_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  client_code text,
  client_name text,
  rm_name text,
  opening_balance numeric,
  closing_balance numeric,
  loan_increase numeric,
  first_date date,
  last_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_start_dt date;
  v_end_dt date;
  v_opening_dt date;
BEGIN
  -- Set default dates
  v_end_dt := COALESCE(p_to_date, CURRENT_DATE);
  v_start_dt := COALESCE(p_from_date, CURRENT_DATE - INTERVAL '30 days');
  
  -- If from_date = to_date, use previous day for opening balance
  IF v_start_dt = v_end_dt THEN
    v_opening_dt := v_start_dt - INTERVAL '1 day';
  ELSE
    v_opening_dt := v_start_dt;
  END IF;

  RETURN QUERY
  WITH opening_balances AS (
    -- Get the opening balance: either from opening_dt or the most recent before it
    SELECT DISTINCT ON (e.investor_code)
      e.investor_code,
      e.ledger_balance as opening_bal,
      e.eod_date as opening_date
    FROM eod_ledger_snapshots e
    WHERE LOWER(e.account_type) = 'margin'
      AND e.eod_date <= v_opening_dt
    ORDER BY e.investor_code, e.eod_date DESC
  ),
  closing_balances AS (
    -- Get the closing balance from to_date or the most recent on/before it
    SELECT DISTINCT ON (e.investor_code)
      e.investor_code,
      e.ledger_balance as closing_bal,
      e.eod_date as closing_date
    FROM eod_ledger_snapshots e
    WHERE LOWER(e.account_type) = 'margin'
      AND e.eod_date <= v_end_dt
    ORDER BY e.investor_code, e.eod_date DESC
  ),
  combined AS (
    SELECT 
      c.investor_code,
      COALESCE(o.opening_bal, 0) as opening_bal,
      c.closing_bal,
      COALESCE(o.opening_date, v_opening_dt) as first_dt,
      c.closing_date as last_dt
    FROM closing_balances c
    LEFT JOIN opening_balances o ON o.investor_code = c.investor_code
    WHERE c.closing_date > COALESCE(o.opening_date, '1900-01-01'::date)  -- Ensure closing is after opening
  )
  SELECT 
    cb.investor_code as client_code,
    COALESCE(i.investor_name, '') as client_name,
    COALESCE(i.rm_name, '') as rm_name,
    cb.opening_bal as opening_balance,
    cb.closing_bal as closing_balance,
    CASE 
      -- Case 1: Both negative - loan increased if closing more negative
      WHEN cb.closing_bal < 0 AND cb.opening_bal < 0 THEN 
        ABS(cb.closing_bal) - ABS(cb.opening_bal)
      -- Case 2: Opening positive/zero, closing negative - entire closing is new loan
      WHEN cb.closing_bal < 0 AND cb.opening_bal >= 0 THEN 
        ABS(cb.closing_bal) + cb.opening_bal
      ELSE 0
    END as loan_increase,
    cb.first_dt as first_date,
    cb.last_dt as last_date
  FROM combined cb
  LEFT JOIN investors i ON i.investor_code = cb.investor_code
  WHERE 
    -- Must have a negative closing balance (has a loan)
    cb.closing_bal < 0
    -- Loan must have increased (more liability than before)
    AND (
      (cb.opening_bal < 0 AND cb.closing_bal < cb.opening_bal)  -- Both negative, closing more negative
      OR (cb.opening_bal >= 0 AND cb.closing_bal < 0)  -- Was positive/zero, now has loan
    )
    -- Exclude closed accounts
    AND (i.status IS NULL OR UPPER(i.status) NOT IN ('CLOSED'))
  ORDER BY 
    CASE 
      WHEN cb.closing_bal < 0 AND cb.opening_bal < 0 THEN ABS(cb.closing_bal) - ABS(cb.opening_bal)
      WHEN cb.closing_bal < 0 AND cb.opening_bal >= 0 THEN ABS(cb.closing_bal) + cb.opening_bal
      ELSE 0
    END DESC;
END;
$$;