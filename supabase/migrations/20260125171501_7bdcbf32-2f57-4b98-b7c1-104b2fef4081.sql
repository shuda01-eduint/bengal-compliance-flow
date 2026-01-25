-- Drop and recreate with dynamic status logic
DROP FUNCTION IF EXISTS get_margin_client_accounts(text, text, integer);

CREATE OR REPLACE FUNCTION get_margin_client_accounts(
  p_search TEXT DEFAULT '',
  p_account_type TEXT DEFAULT 'all',
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  investor_code TEXT,
  investor_name TEXT,
  rm_name TEXT,
  current_exposure NUMERIC,
  accrued_interest NUMERIC,
  portfolio_value NUMERIC,
  equity NUMERIC,
  margin_ratio NUMERIC,
  margin_utilization NUMERIC,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_date DATE;
  v_quarter_start DATE;
BEGIN
  -- Get the latest EOD date
  SELECT MAX(eod_date) INTO v_latest_date FROM eod_ledger_snapshots;
  
  -- Get current quarter start
  v_quarter_start := date_trunc('quarter', v_latest_date)::date;
  
  RETURN QUERY
  SELECT 
    mes.investor_code,
    i.investor_name,
    mes.rm_name,
    ABS(mes.ledger_closing_balance) as current_exposure,
    COALESCE(ai.quarterly_accrued_interest, 0) as accrued_interest,
    mes.total_portfolio_value as portfolio_value,
    (mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) as equity,
    CASE 
      WHEN ABS(mes.ledger_closing_balance) > 0 THEN
        ((mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) / ABS(mes.ledger_closing_balance)) * 100
      ELSE 0
    END as margin_ratio,
    (ABS(mes.ledger_closing_balance) / NULLIF(mes.total_portfolio_value, 0)) * 100 as margin_utilization,
    -- Priority-based status: Negative Equity > Critical > Suspended > Active
    CASE
      WHEN (mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) < 0 
        THEN 'negative_equity'
      WHEN ABS(mes.ledger_closing_balance) > 0 AND
           ((mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) / ABS(mes.ledger_closing_balance)) * 100 < 110
        THEN 'critical'
      WHEN ma.status = 'suspended' THEN 'suspended'
      ELSE 'active'
    END as status
  FROM margin_equity_snapshots mes
  LEFT JOIN investors i ON i.investor_code = mes.investor_code
  LEFT JOIN margin_accounts ma ON ma.investor_code = mes.investor_code
  LEFT JOIN LATERAL (
    SELECT SUM(els.accrued_interest) as quarterly_accrued_interest
    FROM eod_ledger_snapshots els
    WHERE els.investor_code = mes.investor_code
      AND els.eod_date >= v_quarter_start
      AND els.eod_date <= v_latest_date
  ) ai ON TRUE
  WHERE mes.ledger_closing_balance < 0
    AND (p_search = '' OR mes.investor_code ILIKE '%' || p_search || '%')
    AND (p_account_type = 'all' OR mes.account_type = p_account_type)
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit;
END;
$$;