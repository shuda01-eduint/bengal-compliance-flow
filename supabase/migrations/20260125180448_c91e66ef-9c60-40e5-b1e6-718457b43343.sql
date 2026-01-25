-- Drop existing function and recreate with array support for multi-select status
DROP FUNCTION IF EXISTS public.get_margin_client_accounts(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_margin_client_accounts(
  p_search text DEFAULT '',
  p_account_type text DEFAULT 'all',
  p_statuses text[] DEFAULT ARRAY['all']::text[],
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  rm_name text,
  account_type text,
  current_exposure numeric,
  accrued_interest numeric,
  portfolio_value numeric,
  equity numeric,
  margin_ratio numeric,
  status text
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
      els.rm_name,
      els.account_type,
      els.closing_balance as ledger_balance,
      els.interest_rate,
      els.eod_date
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
      ls.rm_name,
      COALESCE(ls.account_type, 'cash') as account_type,
      -- Current exposure is the absolute value of negative ledger balance
      CASE WHEN ls.ledger_balance < 0 THEN ABS(ls.ledger_balance) ELSE 0 END as current_exposure,
      -- Calculate accrued interest (quarterly compounding approximation)
      CASE 
        WHEN ls.ledger_balance < 0 THEN 
          ROUND((COALESCE(ls.interest_rate, 0) / 365 / 100) * ABS(ls.ledger_balance) * 90, 2)
        ELSE 0 
      END as accrued_interest,
      COALESCE(pv.total_portfolio_value, 0) as portfolio_value,
      -- Equity = portfolio value + ledger balance (ledger balance is negative for margin accounts)
      COALESCE(pv.total_portfolio_value, 0) + COALESCE(ls.ledger_balance, 0) as equity,
      -- Margin ratio = (current_exposure / portfolio_value) * 100
      CASE 
        WHEN COALESCE(pv.total_portfolio_value, 0) > 0 AND ls.ledger_balance < 0 THEN
          ROUND((ABS(ls.ledger_balance) / pv.total_portfolio_value) * 100, 2)
        ELSE 0 
      END as margin_ratio
    FROM latest_snapshot ls
    LEFT JOIN portfolio_values pv ON ls.investor_code = pv.investor_code
    WHERE ls.ledger_balance < 0  -- Only margin accounts (negative balance)
  ),
  status_calculated AS (
    SELECT
      md.*,
      -- Status priority: negative_equity > critical > suspended > active
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
  )
  SELECT
    sc.investor_code,
    sc.investor_name,
    sc.rm_name,
    sc.account_type,
    sc.current_exposure,
    sc.accrued_interest,
    sc.portfolio_value,
    sc.equity,
    sc.margin_ratio,
    sc.calculated_status as status
  FROM status_calculated sc
  WHERE
    -- Search filter
    (p_search = '' OR sc.investor_code ILIKE '%' || p_search || '%')
    -- Account type filter
    AND (p_account_type = 'all' OR sc.account_type = p_account_type)
    -- Multi-select status filter
    AND (
      'all' = ANY(p_statuses) 
      OR array_length(p_statuses, 1) IS NULL
      OR sc.calculated_status = ANY(p_statuses)
    )
  ORDER BY sc.current_exposure DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;