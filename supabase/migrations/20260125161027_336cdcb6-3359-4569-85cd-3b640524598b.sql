-- Fix get_margin_dashboard_summary to only sum values for margin accounts (negative balance)
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

  -- Only aggregate values for margin accounts (ledger_closing_balance < 0)
  SELECT json_build_object(
    'eod_date', v_eod_date,
    -- Sum only for margin accounts (negative balance = margin outstanding)
    'total_margin_outstanding', COALESCE(SUM(
      CASE WHEN ledger_closing_balance < 0 THEN ABS(ledger_closing_balance) ELSE 0 END
    ), 0),
    'total_portfolio_value', COALESCE(SUM(
      CASE WHEN ledger_closing_balance < 0 THEN total_portfolio_value ELSE 0 END
    ), 0),
    'total_equity', COALESCE(SUM(
      CASE WHEN ledger_closing_balance < 0 THEN equity ELSE 0 END
    ), 0),
    'total_accrued_interest', COALESCE(SUM(
      CASE WHEN ledger_closing_balance < 0 THEN accrued_interest ELSE 0 END
    ), 0),
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