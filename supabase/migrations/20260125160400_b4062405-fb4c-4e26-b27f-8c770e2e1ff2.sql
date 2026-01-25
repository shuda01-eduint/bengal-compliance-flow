-- Create RPC function for margin dashboard summary (server-side aggregation)
CREATE OR REPLACE FUNCTION public.get_margin_dashboard_summary(p_eod_date date DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eod_date date;
  v_result JSON;
BEGIN
  -- Use provided date or latest available
  IF p_eod_date IS NULL THEN
    SELECT MAX(eod_date) INTO v_eod_date FROM eod_ledger_snapshots;
  ELSE
    v_eod_date := p_eod_date;
  END IF;

  -- If no data available, return empty result
  IF v_eod_date IS NULL THEN
    RETURN json_build_object(
      'eod_date', NULL,
      'total_margin_outstanding', 0,
      'total_portfolio_value', 0,
      'total_equity', 0,
      'total_accrued_interest', 0,
      'high_risk_count', 0,
      'warning_count', 0,
      'safe_count', 0,
      'total_margin_clients', 0
    );
  END IF;

  SELECT json_build_object(
    'eod_date', v_eod_date,
    'total_margin_outstanding', COALESCE(SUM(ABS(LEAST(ledger_closing_balance, 0))), 0),
    'total_portfolio_value', COALESCE(SUM(total_portfolio_value), 0),
    'total_equity', COALESCE(SUM(equity), 0),
    'total_accrued_interest', COALESCE(SUM(accrued_interest), 0),
    'high_risk_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 < 110
    ),
    'warning_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 >= 110 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 < 130
    ),
    'safe_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 >= 130
    ),
    'total_margin_clients', COUNT(*) FILTER (WHERE ledger_closing_balance < 0)
  ) INTO v_result
  FROM margin_equity_snapshots
  WHERE eod_date = v_eod_date;

  RETURN v_result;
END;
$$;

-- Create RPC function for top margin clients by exposure
CREATE OR REPLACE FUNCTION public.get_top_margin_clients(
  p_eod_date date DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  investor_code text,
  rm_name text,
  department_name text,
  exposure numeric,
  margin_ratio numeric,
  equity numeric,
  portfolio_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eod_date date;
BEGIN
  -- Use provided date or latest available
  IF p_eod_date IS NULL THEN
    SELECT MAX(eod_date) INTO v_eod_date FROM eod_ledger_snapshots;
  ELSE
    v_eod_date := p_eod_date;
  END IF;

  -- If no data available, return empty
  IF v_eod_date IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    mes.investor_code::text,
    mes.rm_name::text,
    mes.department_name::text,
    ABS(mes.ledger_closing_balance)::numeric as exposure,
    (mes.equity / NULLIF(ABS(mes.ledger_closing_balance), 0) * 100)::numeric as margin_ratio,
    mes.equity::numeric,
    mes.total_portfolio_value::numeric as portfolio_value
  FROM margin_equity_snapshots mes
  WHERE mes.eod_date = v_eod_date
    AND mes.ledger_closing_balance < 0
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit;
END;
$$;