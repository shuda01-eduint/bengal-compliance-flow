CREATE OR REPLACE FUNCTION public.get_accounting_turnover_by_department(
  _from_tx_date date DEFAULT NULL::date,
  _to_tx_date date DEFAULT NULL::date
)
RETURNS TABLE(
  department text,
  total_buy numeric,
  total_sell numeric,
  turnover numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(th.side, '')) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS total_buy,
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(th.side, '')) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END), 0) AS total_sell,
    COALESCE(SUM(COALESCE(th.value, 0)), 0) AS turnover
  FROM public.trade_history th
  WHERE (
      UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF')
    )
    AND COALESCE(th.value, 0) > 0
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY COALESCE(th.department, 'Unknown')
  ORDER BY turnover DESC;
END;
$$;