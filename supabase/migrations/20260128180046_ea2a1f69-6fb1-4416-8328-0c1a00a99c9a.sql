
-- Fix get_commission_by_department to correctly calculate commission
-- Commission rate is stored as percentage (e.g., 0.4 = 0.4%) not decimal (0.4 = 40%)
-- So we need to divide by 100 to get correct commission amount

CREATE OR REPLACE FUNCTION public.get_commission_by_department(_from_tx_date date DEFAULT NULL::date, _to_tx_date date DEFAULT NULL::date)
 RETURNS TABLE(department text, total_commission numeric, total_turnover numeric, trade_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from_trade_date text;
  _to_trade_date text;
BEGIN
  -- Convert transaction dates to trade date format (yyyyMMdd)
  IF _from_tx_date IS NOT NULL THEN
    _from_trade_date := to_char(_from_tx_date, 'YYYYMMDD');
  END IF;

  IF _to_tx_date IS NOT NULL THEN
    _to_trade_date := to_char(_to_tx_date, 'YYYYMMDD');
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(th.department, 'Unknown') AS department,
    -- Fix: Commission rate is stored as percentage (0.4 = 0.4%), need to divide by 100
    -- Also handle the normalization for rates stored differently (>= 0.1 is percentage format)
    COALESCE(SUM(
      CASE 
        WHEN COALESCE(th.brokerage_commission, 0.4) >= 0.1 
        THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.4) / 100
        ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.004)
      END
    ), 0) AS total_commission,
    COALESCE(SUM(COALESCE(th.value, 0)), 0) AS total_turnover,
    COUNT(*) AS trade_count
  FROM public.trade_history th
  WHERE (
      UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF')
    )
    AND COALESCE(th.value, 0) > 0
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY COALESCE(th.department, 'Unknown')
  ORDER BY total_commission DESC;
END;
$function$;
