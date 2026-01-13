-- Fix the get_negative_balance_codes function with correct column names
CREATE OR REPLACE FUNCTION public.get_negative_balance_codes(
  from_dt date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  to_dt date DEFAULT CURRENT_DATE,
  search_term text DEFAULT NULL
)
RETURNS TABLE (
  event_date date,
  client_code text,
  client_name text,
  rm_name text,
  department text,
  opening_balance numeric,
  closing_balance numeric,
  amount numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH daily_activity AS (
    -- Get trade values per client per day
    SELECT 
      th.client_code as inv_code,
      th.trade_date::date as activity_date,
      SUM(CASE WHEN LOWER(th.side) = 'sell' THEN th.value ELSE 0 END) as sell_value,
      SUM(CASE WHEN LOWER(th.side) = 'buy' THEN -th.value ELSE 0 END) as buy_value
    FROM trade_history th
    WHERE th.trade_date::date BETWEEN from_dt AND to_dt
    GROUP BY th.client_code, th.trade_date::date
    
    UNION ALL
    
    -- Get deposits/withdrawals per client per day
    SELECT 
      dw.investor_code as inv_code,
      dw.transaction_date as activity_date,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN dw.amount ELSE 0 END) as deposit_value,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN -dw.amount ELSE 0 END) as withdrawal_value
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date BETWEEN from_dt AND to_dt
    GROUP BY dw.investor_code, dw.transaction_date
  ),
  aggregated_activity AS (
    SELECT 
      da.inv_code,
      da.activity_date,
      SUM(da.sell_value + da.buy_value) as net_change
    FROM daily_activity da
    GROUP BY da.inv_code, da.activity_date
  ),
  opening_balances AS (
    SELECT 
      ob.investor_code as inv_code,
      COALESCE(ob.opening_balance, 0) as opening_bal
    FROM opening_balances ob
  ),
  running_balances AS (
    SELECT 
      aa.inv_code,
      aa.activity_date,
      COALESCE(ob.opening_bal, 0) as base_opening,
      aa.net_change,
      COALESCE(ob.opening_bal, 0) + 
        SUM(aa.net_change) OVER (
          PARTITION BY aa.inv_code 
          ORDER BY aa.activity_date 
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as running_balance
    FROM aggregated_activity aa
    LEFT JOIN opening_balances ob ON ob.inv_code = aa.inv_code
  ),
  negative_days AS (
    SELECT 
      rb.inv_code,
      rb.activity_date,
      rb.base_opening + COALESCE(
        SUM(rb.net_change) OVER (
          PARTITION BY rb.inv_code 
          ORDER BY rb.activity_date 
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0
      ) as day_opening,
      rb.running_balance as day_closing
    FROM running_balances rb
    WHERE rb.running_balance < 0
  )
  SELECT 
    nd.activity_date as event_date,
    nd.inv_code as client_code,
    COALESCE(c.client_name, nd.inv_code) as client_name,
    COALESCE(c.rm_name, 'Unknown') as rm_name,
    COALESCE(c.department, 'Unknown') as department,
    ROUND(nd.day_opening, 2) as opening_balance,
    ROUND(nd.day_closing, 2) as closing_balance,
    ROUND(nd.day_closing, 2) as amount
  FROM negative_days nd
  LEFT JOIN clients c ON c.inv_code = nd.inv_code
  WHERE (
    search_term IS NULL 
    OR nd.inv_code ILIKE '%' || search_term || '%'
    OR COALESCE(c.client_name, '') ILIKE '%' || search_term || '%'
    OR COALESCE(c.rm_name, '') ILIKE '%' || search_term || '%'
  )
  ORDER BY nd.activity_date DESC, nd.day_closing ASC;
END;
$$;