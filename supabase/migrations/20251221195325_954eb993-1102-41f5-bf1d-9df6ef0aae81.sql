
-- Function to get margin composition by department (using balances_raw for EOD data)
CREATE OR REPLACE FUNCTION public.get_margin_composition_by_department(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(
  department text,
  margin_loan numeric,
  margin_accounts bigint,
  total_accounts bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH investor_data AS (
    SELECT DISTINCT ON (br.investor_code)
      br.investor_code,
      br.ledger_balance,
      i.account_type,
      COALESCE(ira.department, 'Unknown') as department
    FROM balances_raw br
    LEFT JOIN investors i ON i.investor_code = br.investor_code
    LEFT JOIN investor_rm_assignments ira ON ira.investor_code = br.investor_code
    WHERE br.as_of_date = p_date
  )
  SELECT 
    id.department,
    COALESCE(SUM(
      CASE 
        WHEN LOWER(COALESCE(id.account_type, '')) = 'margin' AND id.ledger_balance < 0 
        THEN ABS(id.ledger_balance) 
        ELSE 0 
      END
    ), 0) as margin_loan,
    COUNT(*) FILTER (WHERE LOWER(COALESCE(id.account_type, '')) = 'margin') as margin_accounts,
    COUNT(*) as total_accounts
  FROM investor_data id
  GROUP BY id.department
  HAVING SUM(
    CASE 
      WHEN LOWER(COALESCE(id.account_type, '')) = 'margin' AND id.ledger_balance < 0 
      THEN ABS(id.ledger_balance) 
      ELSE 0 
    END
  ) > 0
  ORDER BY margin_loan DESC;
END;
$$;

-- Function to get commission by department
CREATE OR REPLACE FUNCTION public.get_commission_by_department(_from_tx_date date DEFAULT NULL, _to_tx_date date DEFAULT NULL)
RETURNS TABLE(
  department text,
  total_commission numeric,
  total_turnover numeric,
  trade_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _from_trade_date text;
  _to_trade_date text;
BEGIN
  -- Convert transaction dates to trade date format (yyyyMMdd)
  IF _from_tx_date IS NOT NULL THEN
    _from_trade_date := to_char(_from_tx_date, 'YYYYMMDD');
  END IF;

  IF _to_tx_date IS NOT NULL THEN
    _to_trade_date := to_char(_to_tx_date, 'YYYYMMDD');
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(th.department, 'Unknown') AS department,
    COALESCE(SUM(COALESCE(th.brokerage_commission, 0) * COALESCE(th.value, 0)), 0) AS total_commission,
    COALESCE(SUM(COALESCE(th.value, 0)), 0) AS total_turnover,
    COUNT(*) AS trade_count
  FROM public.trade_history th
  WHERE (
      UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF')
    )
    AND COALESCE(th.value, 0) > 0
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY COALESCE(th.department, 'Unknown')
  ORDER BY total_commission DESC;
END;
$$;
