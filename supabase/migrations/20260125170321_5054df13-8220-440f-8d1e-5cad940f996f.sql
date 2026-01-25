-- Drop existing function and recreate with new accrued_interest column
DROP FUNCTION IF EXISTS get_margin_client_accounts(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION get_margin_client_accounts(
  p_search text DEFAULT '',
  p_account_type text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  department_name text,
  current_exposure numeric,
  accrued_interest numeric,
  portfolio_value numeric,
  equity numeric,
  margin_ratio numeric,
  margin_utilization numeric,
  status text
) AS $$
DECLARE
  v_latest_date date;
  v_quarter_start date;
BEGIN
  -- Get the latest EOD date
  SELECT MAX(eod_date) INTO v_latest_date FROM eod_ledger_snapshots;
  
  -- Calculate the start of the current quarter
  v_quarter_start := date_trunc('quarter', v_latest_date)::date;
  
  RETURN QUERY
  SELECT 
    mes.investor_code,
    i.investor_name,
    COALESCE(i.account_type, 'Margin') as account_type,
    mes.rm_name,
    mes.department_name,
    ABS(mes.ledger_closing_balance) as current_exposure,
    COALESCE(ai.quarterly_accrued_interest, 0) as accrued_interest,
    mes.total_portfolio_value as portfolio_value,
    -- Equity = Portfolio Value - Margin Loan - Accrued Interest
    (mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) as equity,
    -- Margin Ratio = Equity / Margin Loan * 100
    CASE 
      WHEN ABS(mes.ledger_closing_balance) > 0 THEN
        ((mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) / ABS(mes.ledger_closing_balance)) * 100
      ELSE 0
    END as margin_ratio,
    (ABS(mes.ledger_closing_balance) / NULLIF(mes.total_portfolio_value, 0)) * 100 as margin_utilization,
    'active'::text as status
  FROM margin_equity_snapshots mes
  LEFT JOIN investors i ON i.investor_code = mes.investor_code
  LEFT JOIN LATERAL (
    -- Sum accrued interest for the current quarter
    SELECT SUM(els.accrued_interest) as quarterly_accrued_interest
    FROM eod_ledger_snapshots els
    WHERE els.investor_code = mes.investor_code
      AND els.eod_date >= v_quarter_start
      AND els.eod_date <= v_latest_date
  ) ai ON true
  WHERE mes.eod_date = v_latest_date
    AND mes.ledger_closing_balance < 0
    AND (p_search = '' OR mes.investor_code ILIKE '%' || p_search || '%')
    AND (p_account_type = 'all' OR LOWER(COALESCE(i.account_type, 'margin')) = LOWER(p_account_type))
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;