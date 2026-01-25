-- Create RPC function to get margin treemap data grouped by department and RM
CREATE OR REPLACE FUNCTION public.get_margin_treemap_data()
RETURNS TABLE (
  department_name text,
  rm_name text,
  rm_id text,
  margin_outstanding numeric,
  portfolio_value numeric,
  margin_ratio numeric,
  client_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH latest_date AS (
    SELECT MAX(eod_date) as max_date FROM eod_ledger_snapshots
  ),
  margin_data AS (
    SELECT 
      els.investor_code,
      els.rm_id,
      els.rm_name,
      COALESCE(els.department, 'Unassigned') as department,
      ABS(els.closing_balance) as margin_outstanding,
      COALESCE(ehs.total_portfolio_value, 0) as portfolio_value
    FROM eod_ledger_snapshots els
    CROSS JOIN latest_date ld
    LEFT JOIN LATERAL (
      SELECT SUM(market_value) as total_portfolio_value
      FROM eod_holding_snapshots
      WHERE investor_code = els.investor_code
        AND eod_date = ld.max_date
    ) ehs ON true
    WHERE els.eod_date = ld.max_date
      AND els.closing_balance < 0  -- Only margin accounts (negative balance = loan)
  )
  SELECT 
    md.department as department_name,
    COALESCE(md.rm_name, 'Unassigned') as rm_name,
    COALESCE(md.rm_id, 'unknown') as rm_id,
    COALESCE(SUM(md.margin_outstanding), 0) as margin_outstanding,
    COALESCE(SUM(md.portfolio_value), 0) as portfolio_value,
    CASE 
      WHEN SUM(md.margin_outstanding) > 0 THEN 
        (SUM(md.portfolio_value) / NULLIF(SUM(md.margin_outstanding), 0)) * 100
      ELSE 0 
    END as margin_ratio,
    COUNT(DISTINCT md.investor_code) as client_count
  FROM margin_data md
  GROUP BY md.department, md.rm_name, md.rm_id
  HAVING SUM(md.margin_outstanding) > 0
  ORDER BY md.department, SUM(md.margin_outstanding) DESC;
END;
$$;