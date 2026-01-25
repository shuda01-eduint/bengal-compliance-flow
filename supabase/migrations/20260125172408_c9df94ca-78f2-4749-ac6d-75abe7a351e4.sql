-- Fix regression: PostgREST cannot resolve overloaded get_margin_client_accounts()
-- We remove the legacy 3-arg overload, then recreate a single canonical 5-arg function
-- that includes priority-based statuses.

DROP FUNCTION IF EXISTS public.get_margin_client_accounts(text, text, integer);
DROP FUNCTION IF EXISTS public.get_margin_client_accounts(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_margin_client_accounts(
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_date date;
  v_quarter_start date;
BEGIN
  SELECT max(eod_date) INTO v_latest_date FROM public.eod_ledger_snapshots;
  v_quarter_start := date_trunc('quarter', v_latest_date)::date;

  RETURN QUERY
  SELECT *
  FROM (
    SELECT
      mes.investor_code,
      i.investor_name,
      COALESCE(i.account_type, 'Margin') AS account_type,
      mes.rm_name,
      mes.department_name,
      ABS(mes.ledger_closing_balance) AS current_exposure,
      COALESCE(ai.quarterly_accrued_interest, 0) AS accrued_interest,
      mes.total_portfolio_value AS portfolio_value,
      (mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) AS equity,
      CASE
        WHEN ABS(mes.ledger_closing_balance) > 0 THEN
          ((mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) / ABS(mes.ledger_closing_balance)) * 100
        ELSE 0
      END AS margin_ratio,
      (ABS(mes.ledger_closing_balance) / NULLIF(mes.total_portfolio_value, 0)) * 100 AS margin_utilization,
      CASE
        -- 1) Negative Equity (highest priority)
        WHEN (mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) < 0 THEN 'negative_equity'
        -- 2) Critical (below threshold)
        WHEN ABS(mes.ledger_closing_balance) > 0
          AND (((mes.total_portfolio_value - ABS(mes.ledger_closing_balance) - COALESCE(ai.quarterly_accrued_interest, 0)) / ABS(mes.ledger_closing_balance)) * 100) < 110
          THEN 'critical'
        -- 3) Suspended (manual override)
        WHEN ma.status = 'suspended' THEN 'suspended'
        -- 4) Active (default)
        ELSE 'active'
      END AS status
    FROM public.margin_equity_snapshots mes
    LEFT JOIN public.investors i ON i.investor_code = mes.investor_code
    LEFT JOIN public.margin_accounts ma ON ma.investor_code = mes.investor_code
    LEFT JOIN LATERAL (
      SELECT sum(els.accrued_interest) AS quarterly_accrued_interest
      FROM public.eod_ledger_snapshots els
      WHERE els.investor_code = mes.investor_code
        AND els.eod_date >= v_quarter_start
        AND els.eod_date <= v_latest_date
    ) ai ON true
    WHERE mes.eod_date = v_latest_date
      AND mes.ledger_closing_balance < 0
      AND (
        p_search = ''
        OR mes.investor_code ILIKE '%' || p_search || '%'
        OR i.investor_name ILIKE '%' || p_search || '%'
      )
      AND (
        p_account_type = 'all'
        OR lower(COALESCE(i.account_type, 'margin')) = lower(p_account_type)
      )
    ORDER BY ABS(mes.ledger_closing_balance) DESC
    LIMIT p_limit
    OFFSET p_offset
  ) q
  WHERE p_status = 'all' OR q.status = p_status;
END;
$$;