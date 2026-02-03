-- Create RPC function for Z Group Adjustment violations
CREATE OR REPLACE FUNCTION public.get_z_group_violations(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  event_date date,
  client_code text,
  client_name text,
  department text,
  rm_name text,
  z_buy_value numeric,
  z_sell_value numeric,
  other_buy_value numeric,
  other_sell_value numeric,
  opening_balance numeric,
  matured_balance numeric,
  adjustment_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_dt date;
  v_to_dt date;
BEGIN
  -- Default dates if not provided
  v_from_dt := COALESCE(p_from_date, CURRENT_DATE - INTERVAL '7 days');
  v_to_dt := COALESCE(p_to_date, CURRENT_DATE);

  RETURN QUERY
  WITH z_instruments AS (
    SELECT trading_code FROM public.instrument WHERE upper(trim(category)) = 'Z'
  ),
  trade_summary AS (
    SELECT 
      t.trade_date,
      t.investor_code,
      COALESCE(SUM(CASE WHEN upper(t.side) = 'BUY' AND zi.trading_code IS NOT NULL THEN COALESCE(t.trade_value, 0) ELSE 0 END), 0) as z_buy,
      COALESCE(SUM(CASE WHEN upper(t.side) = 'SELL' AND zi.trading_code IS NOT NULL THEN COALESCE(t.trade_value, 0) ELSE 0 END), 0) as z_sell,
      COALESCE(SUM(CASE WHEN upper(t.side) = 'BUY' AND zi.trading_code IS NULL THEN COALESCE(t.trade_value, 0) ELSE 0 END), 0) as other_buy,
      COALESCE(SUM(CASE WHEN upper(t.side) = 'SELL' AND zi.trading_code IS NULL THEN COALESCE(t.trade_value, 0) ELSE 0 END), 0) as other_sell
    FROM public.trades t
    LEFT JOIN z_instruments zi ON upper(trim(t.instrument)) = upper(trim(zi.trading_code))
    WHERE t.trade_date BETWEEN v_from_dt AND v_to_dt
    GROUP BY t.trade_date, t.investor_code
    HAVING SUM(CASE WHEN zi.trading_code IS NOT NULL THEN 1 ELSE 0 END) > 0
  ),
  with_balances AS (
    SELECT 
      ts.trade_date,
      ts.investor_code,
      ts.z_buy,
      ts.z_sell,
      ts.other_buy,
      ts.other_sell,
      COALESCE(eod.opening_balance, 0) as opening_bal,
      COALESCE(eod.matured_balance, 0) as matured_bal,
      c.investor_name,
      COALESCE(eod.department, '') as dept,
      c.rm_name
    FROM trade_summary ts
    LEFT JOIN public.eod_ledger_snapshots eod 
      ON eod.investor_code = ts.investor_code 
      AND eod.eod_date = ts.trade_date
    LEFT JOIN public.clients c ON c.inv_code = ts.investor_code
    WHERE c.status != 'CLOSED' OR c.status IS NULL
  )
  SELECT 
    wb.trade_date as event_date,
    wb.investor_code as client_code,
    wb.investor_name as client_name,
    wb.dept as department,
    wb.rm_name,
    wb.z_buy as z_buy_value,
    wb.z_sell as z_sell_value,
    wb.other_buy as other_buy_value,
    wb.other_sell as other_sell_value,
    wb.opening_bal as opening_balance,
    wb.matured_bal as matured_balance,
    -- Calculate adjustment amount based on which condition triggered
    CASE 
      -- Condition 1: Net Z Buy > Matured Balance
      WHEN (wb.z_buy - wb.z_sell) > wb.matured_bal 
        THEN (wb.z_buy - wb.z_sell) - wb.matured_bal
      -- Condition 2: Z sell > 0 AND ((Other Sale + Opening) - Total Buy) < 0
      WHEN wb.z_sell > 0 AND ((wb.other_sell + wb.opening_bal) - (wb.z_buy + wb.other_buy)) < 0 
        THEN ABS((wb.other_sell + wb.opening_bal) - (wb.z_buy + wb.other_buy))
      ELSE 0
    END as adjustment_amount
  FROM with_balances wb
  WHERE 
    -- Condition 1: Net Z Buy > Matured Balance
    (wb.z_buy - wb.z_sell) > wb.matured_bal
    OR
    -- Condition 2: Z sell > 0 AND insufficient funds to cover buys
    (wb.z_sell > 0 AND ((wb.other_sell + wb.opening_bal) - (wb.z_buy + wb.other_buy)) < 0);
END;
$$;