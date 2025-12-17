CREATE OR REPLACE FUNCTION public.get_accounting_trade_sums(_from_trade_date text, _to_trade_date text)
 RETURNS TABLE(client_code text, buy_sum numeric, sell_sum numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    th.client_code,
    COALESCE(SUM(CASE WHEN upper(th.side) IN ('B','BUY') THEN th.value ELSE 0 END), 0) AS buy_sum,
    COALESCE(SUM(CASE WHEN upper(th.side) IN ('S','SELL') THEN th.value ELSE 0 END), 0) AS sell_sum
  FROM public.trade_history th
  WHERE th.client_code IS NOT NULL
    AND th.trade_date >= _from_trade_date
    AND th.trade_date <= _to_trade_date
    AND COALESCE(th.value, 0) <> 0
  GROUP BY th.client_code;
$function$;