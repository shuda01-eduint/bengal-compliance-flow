-- Create function to get turnover by department for accounting period
CREATE OR REPLACE FUNCTION get_accounting_turnover_by_department(
  _from_tx_date DATE DEFAULT NULL,
  _to_tx_date DATE DEFAULT NULL
)
RETURNS TABLE (
  department TEXT,
  total_buy NUMERIC,
  total_sell NUMERIC,
  turnover NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_trade_date TEXT;
  _to_trade_date TEXT;
BEGIN
  -- Convert transaction dates to trade date format (yyyyMMdd)
  IF _from_tx_date IS NOT NULL THEN
    _from_trade_date := TO_CHAR(_from_tx_date, 'YYYYMMDD');
  END IF;
  
  IF _to_tx_date IS NOT NULL THEN
    _to_trade_date := TO_CHAR(_to_tx_date, 'YYYYMMDD');
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(th.department, 'Unknown') AS department,
    COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) AS total_buy,
    COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) AS total_sell,
    COALESCE(SUM(th.value), 0) AS turnover
  FROM trade_history th
  WHERE th.status = 'Executed'
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY th.department
  ORDER BY turnover DESC;
END;
$$;