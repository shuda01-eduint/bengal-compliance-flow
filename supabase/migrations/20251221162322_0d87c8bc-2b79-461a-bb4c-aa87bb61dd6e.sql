CREATE OR REPLACE FUNCTION public.get_accounting_turnover_by_department(_from_tx_date text DEFAULT NULL::text, _to_tx_date text DEFAULT NULL::text)
 RETURNS TABLE(department text, total_buy numeric, total_sell numeric, turnover numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from_trade_date TEXT;
  _to_trade_date TEXT;
BEGIN
  -- Convert transaction dates to trade date format (yyyyMMdd) with proper DATE cast
  IF _from_tx_date IS NOT NULL THEN
    _from_trade_date := TO_CHAR(_from_tx_date::DATE, 'YYYYMMDD');
  END IF;
  
  IF _to_tx_date IS NOT NULL THEN
    _to_trade_date := TO_CHAR(_to_tx_date::DATE, 'YYYYMMDD');
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(th.department, 'Unknown') AS department,
    COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) AS total_buy,
    COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) AS total_sell,
    COALESCE(SUM(th.value), 0) AS turnover
  FROM trade_history th
  WHERE th.client_code IS NOT NULL
    AND (UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF') OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF'))
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY th.department
  ORDER BY turnover DESC;
END;
$function$;