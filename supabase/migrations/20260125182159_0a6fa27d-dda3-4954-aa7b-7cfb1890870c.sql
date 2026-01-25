
-- Create a summary RPC that returns total aggregates for margin client accounts
-- This bypasses pagination to give accurate totals for metric cards
CREATE OR REPLACE FUNCTION public.get_margin_client_summary(
  p_search text DEFAULT '',
  p_account_type text DEFAULT 'all',
  p_statuses text[] DEFAULT ARRAY['all']
)
RETURNS TABLE (
  total_accounts bigint,
  total_margin_outstanding numeric,
  total_equity numeric,
  total_portfolio_value numeric,
  total_accrued_interest numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH latest_snapshot AS (
    SELECT DISTINCT ON (els.investor_code)
      els.investor_code,
      els.investor_name,
      els.account_type,
      els.closing_balance as ledger_balance,
      els.interest_rate
    FROM eod_ledger_snapshots els
    ORDER BY els.investor_code, els.eod_date DESC
  ),
  portfolio_values AS (
    SELECT 
      ehs.investor_code,
      SUM(COALESCE(ehs.market_value, 0)) as total_portfolio_value
    FROM eod_holding_snapshots ehs
    WHERE ehs.eod_date = (SELECT MAX(eod_date) FROM eod_holding_snapshots)
    GROUP BY ehs.investor_code
  ),
  margin_data AS (
    SELECT
      ls.investor_code,
      ls.investor_name,
      COALESCE(ls.account_type, 'cash') as account_type,
      CASE WHEN ls.ledger_balance < 0 THEN ABS(ls.ledger_balance) ELSE 0 END as current_exposure,
      CASE 
        WHEN ls.ledger_balance < 0 THEN 
          ROUND((COALESCE(ls.interest_rate, 0) / 365 / 100) * ABS(ls.ledger_balance) * 90, 2)
        ELSE 0 
      END as accrued_interest,
      COALESCE(pv.total_portfolio_value, 0) as portfolio_value,
      COALESCE(pv.total_portfolio_value, 0) + COALESCE(ls.ledger_balance, 0) as equity,
      CASE 
        WHEN COALESCE(pv.total_portfolio_value, 0) > 0 AND ls.ledger_balance < 0 THEN
          ROUND((ABS(ls.ledger_balance) / pv.total_portfolio_value) * 100, 2)
        ELSE 0 
      END as margin_ratio
    FROM latest_snapshot ls
    LEFT JOIN portfolio_values pv ON ls.investor_code = pv.investor_code
    WHERE ls.ledger_balance < 0
  ),
  status_calculated AS (
    SELECT
      md.*,
      CASE
        WHEN md.equity < 0 THEN 'negative_equity'
        WHEN md.margin_ratio >= 110 THEN 'critical'
        WHEN EXISTS (
          SELECT 1 FROM margin_accounts ma 
          WHERE ma.investor_code = md.investor_code 
          AND ma.status = 'suspended'
        ) THEN 'suspended'
        ELSE 'active'
      END as calculated_status
    FROM margin_data md
  ),
  filtered_data AS (
    SELECT *
    FROM status_calculated sc
    WHERE
      (p_search = '' OR sc.investor_code ILIKE '%' || p_search || '%')
      AND (p_account_type = 'all' OR sc.account_type = p_account_type)
      AND (
        'all' = ANY(p_statuses) 
        OR array_length(p_statuses, 1) IS NULL
        OR sc.calculated_status = ANY(p_statuses)
      )
  )
  SELECT
    COUNT(*)::bigint as total_accounts,
    COALESCE(SUM(current_exposure), 0)::numeric as total_margin_outstanding,
    COALESCE(SUM(equity), 0)::numeric as total_equity,
    COALESCE(SUM(portfolio_value), 0)::numeric as total_portfolio_value,
    COALESCE(SUM(accrued_interest), 0)::numeric as total_accrued_interest
  FROM filtered_data;
END;
$$;
