-- Create RPC function for fetching margin client accounts with real data
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
  portfolio_value numeric,
  equity numeric,
  margin_ratio numeric,
  margin_utilization numeric,
  status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mes.investor_code,
    i.investor_name,
    COALESCE(i.account_type, 'Margin') as account_type,
    mes.rm_name,
    mes.department_name,
    ABS(mes.ledger_closing_balance) as current_exposure,
    mes.total_portfolio_value as portfolio_value,
    mes.equity,
    (mes.equity / NULLIF(ABS(mes.ledger_closing_balance), 0)) * 100 as margin_ratio,
    (ABS(mes.ledger_closing_balance) / NULLIF(mes.total_portfolio_value, 0)) * 100 as margin_utilization,
    'active'::text as status
  FROM margin_equity_snapshots mes
  LEFT JOIN investors i ON i.investor_code = mes.investor_code
  WHERE mes.eod_date = (SELECT MAX(eod_date) FROM eod_ledger_snapshots)
    AND mes.ledger_closing_balance < 0
    AND (p_search = '' OR mes.investor_code ILIKE '%' || p_search || '%')
    AND (p_account_type = 'all' OR LOWER(COALESCE(i.account_type, 'margin')) = LOWER(p_account_type))
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;