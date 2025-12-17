-- Update Accounting aggregation to use trade file import window (uploaded_at) for the selected date range
CREATE OR REPLACE FUNCTION public.get_accounting_trade_sums(
  _from_trade_date text,
  _to_trade_date text
)
RETURNS TABLE(
  client_code text,
  buy_sum numeric,
  sell_sum numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH params AS (
    SELECT
      to_date(_from_trade_date, 'YYYYMMDD')::timestamptz AS from_ts,
      (to_date(_to_trade_date, 'YYYYMMDD') + 1)::timestamptz AS to_exclusive_ts
  )
  SELECT
    th.client_code,
    COALESCE(SUM(CASE WHEN upper(th.side) IN ('B','BUY') THEN th.value ELSE 0 END), 0) AS buy_sum,
    COALESCE(SUM(CASE WHEN upper(th.side) IN ('S','SELL') THEN th.value ELSE 0 END), 0) AS sell_sum
  FROM public.trade_history th
  CROSS JOIN params p
  WHERE th.client_code IS NOT NULL
    AND th.uploaded_at >= p.from_ts
    AND th.uploaded_at < p.to_exclusive_ts
  GROUP BY th.client_code;
$$;