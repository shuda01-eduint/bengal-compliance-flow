-- Phase 2 & 3: Add statement timeouts and fix opening balance date logic

-- Fix get_accounting_data_v3: Remove double subtraction bug in opening balance logic
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date, 
  _tx_date date, 
  _search text DEFAULT ''::text, 
  _account_type_filter text DEFAULT 'all'::text, 
  _has_activity_filter text DEFAULT 'all'::text, 
  _limit integer DEFAULT 100, 
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  investor_code text, 
  investor_name text, 
  account_type text, 
  rm_name text, 
  rm_email text, 
  department text, 
  opening_balance numeric, 
  gross_buy numeric, 
  gross_sell numeric, 
  net_trade_value numeric, 
  total_deposits numeric, 
  total_withdrawals numeric, 
  brokerage numeric, 
  closing_balance numeric, 
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _from_date_str TEXT;
  _to_date_str TEXT;
BEGIN
  -- Convert dates to YYYYMMDD format for trade_history
  _from_date_str := TO_CHAR(_opening_date, 'YYYYMMDD');
  _to_date_str := TO_CHAR(_tx_date, 'YYYYMMDD');

  RETURN QUERY
  WITH 
  -- Get trades first - this is the primary filter for "with_trades"
  period_trades AS MATERIALIZED (
    SELECT
      th.client_code AS inv_code,
      SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN COALESCE(th.value, 0) ELSE 0 END) AS gross_sell,
      SUM(
        CASE 
          WHEN COALESCE(th.brokerage_commission, 0.4) >= 0.1 
          THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.4) / 100
          ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.004)
        END
      ) AS brokerage
    FROM public.trade_history th
    WHERE th.trade_date >= _from_date_str
      AND th.trade_date <= _to_date_str
    GROUP BY th.client_code
  ),
  -- When filtering for trades, only fetch those investors
  investor_base AS MATERIALIZED (
    SELECT 
      i.investor_code AS inv_code,
      i.investor_name,
      i.account_type,
      i.rm_name,
      i.department
    FROM public.investors i
    WHERE (
      _has_activity_filter NOT IN ('with_trades', 'yes')
      OR i.investor_code IN (SELECT pt.inv_code FROM period_trades pt)
    )
    AND (_search = '' OR i.investor_code ILIKE '%' || _search || '%' OR i.investor_name ILIKE '%' || _search || '%')
    AND (_account_type_filter = 'all' OR LOWER(COALESCE(i.account_type, '')) = LOWER(_account_type_filter))
  ),
  -- FIX: Use _opening_date directly - frontend now sends the correct opening balance date
  -- Previously: els.eod_date = (_opening_date - INTERVAL '1 day')::date (double subtraction bug)
  opening_balances AS (
    SELECT els.investor_code AS inv_code, COALESCE(els.closing_balance, 0) AS opening_balance
    FROM public.eod_ledger_snapshots els
    WHERE els.eod_date = _opening_date
      AND els.investor_code IN (SELECT ib.inv_code FROM investor_base ib)
  ),
  period_deposits AS (
    SELECT
      dw.investor_code AS inv_code,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'deposit' THEN dw.amount ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN LOWER(dw.transaction_type) = 'withdrawal' THEN dw.amount ELSE 0 END) AS total_withdrawals
    FROM public.deposits_withdrawals dw
    WHERE dw.transaction_date BETWEEN _opening_date AND _tx_date
      AND dw.investor_code IN (SELECT ib.inv_code FROM investor_base ib)
    GROUP BY dw.investor_code
  ),
  combined AS (
    SELECT
      ib.inv_code,
      ib.investor_name,
      ib.account_type,
      ib.rm_name,
      ib.department,
      COALESCE(ob.opening_balance, 0) AS opening_balance,
      COALESCE(pt.gross_buy, 0) AS gross_buy,
      COALESCE(pt.gross_sell, 0) AS gross_sell,
      COALESCE(pt.gross_sell, 0) - COALESCE(pt.gross_buy, 0) AS net_trade_value,
      COALESCE(pd.total_deposits, 0) AS total_deposits,
      COALESCE(pd.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(pt.brokerage, 0) AS brokerage,
      COALESCE(ob.opening_balance, 0) + COALESCE(pd.total_deposits, 0) - COALESCE(pd.total_withdrawals, 0) 
        + COALESCE(pt.gross_sell, 0) - COALESCE(pt.gross_buy, 0) - COALESCE(pt.brokerage, 0) AS closing_balance,
      (COALESCE(pt.gross_buy, 0) > 0 OR COALESCE(pt.gross_sell, 0) > 0) AS has_trades,
      (COALESCE(pd.total_deposits, 0) > 0 OR COALESCE(pd.total_withdrawals, 0) > 0) AS has_activity
    FROM investor_base ib
    LEFT JOIN opening_balances ob ON ob.inv_code = ib.inv_code
    LEFT JOIN period_trades pt ON pt.inv_code = ib.inv_code
    LEFT JOIN period_deposits pd ON pd.inv_code = ib.inv_code
  ),
  filtered AS (
    SELECT c.* FROM combined c
    WHERE _has_activity_filter = 'all'
      OR (_has_activity_filter = 'yes' AND (c.has_trades OR c.has_activity))
      OR (_has_activity_filter = 'no' AND NOT c.has_trades AND NOT c.has_activity)
      OR (_has_activity_filter = 'with_trades' AND c.has_trades)
      OR (_has_activity_filter = 'no_trades' AND NOT c.has_trades)
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT 
    f.inv_code::text, f.investor_name::text, f.account_type::text, f.rm_name::text, 
    ''::text AS rm_email, f.department::text, f.opening_balance, f.gross_buy, f.gross_sell,
    f.net_trade_value, f.total_deposits, f.total_withdrawals, f.brokerage, f.closing_balance, t.cnt
  FROM filtered f CROSS JOIN total t
  ORDER BY f.inv_code
  LIMIT _limit OFFSET _offset;
END;
$function$;

-- Add explicit 60s timeout to get_accounting_turnover_by_department
CREATE OR REPLACE FUNCTION public.get_accounting_turnover_by_department(
  _from_tx_date date DEFAULT NULL::date, 
  _to_tx_date date DEFAULT NULL::date
)
RETURNS TABLE(department text, total_buy numeric, total_sell numeric, turnover numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
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
    COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) AS total_buy,
    COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) AS total_sell,
    COALESCE(SUM(COALESCE(th.value, 0)), 0) AS turnover
  FROM public.trade_history th
  WHERE (
      UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF')
      OR UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF')
    )
    AND COALESCE(th.value, 0) > 0
    AND (_from_trade_date IS NULL OR th.trade_date >= _from_trade_date)
    AND (_to_trade_date IS NULL OR th.trade_date <= _to_trade_date)
  GROUP BY COALESCE(th.department, 'Unknown')
  ORDER BY turnover DESC;
END;
$function$;

-- Add explicit 60s timeout to get_commission_by_department
CREATE OR REPLACE FUNCTION public.get_commission_by_department(
  _from_tx_date date DEFAULT NULL::date, 
  _to_tx_date date DEFAULT NULL::date
)
RETURNS TABLE(department text, total_commission numeric, total_turnover numeric, trade_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
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
    -- Fix: Commission rate is stored as percentage (0.4 = 0.4%), need to divide by 100
    -- Also handle the normalization for rates stored differently (>= 0.1 is percentage format)
    COALESCE(SUM(
      CASE 
        WHEN COALESCE(th.brokerage_commission, 0.4) >= 0.1 
        THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.4) / 100
        ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.004)
      END
    ), 0) AS total_commission,
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
$function$;