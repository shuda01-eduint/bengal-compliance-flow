-- 1) Drop ALL overloaded versions of get_accounting_data (to remove RPC ambiguity)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_accounting_data'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE;', r.schema_name, r.function_name, r.args);
  END LOOP;
END $$;

-- 2) Create a single, unambiguous v2 function with the correct signature
CREATE OR REPLACE FUNCTION public.get_accounting_data_v2(
  _search text,
  _from_trade_date text,
  _to_trade_date text,
  _from_tx_date text,
  _to_tx_date text,
  _account_type_filter text,
  _has_activity_filter text,
  _limit integer,
  _offset integer
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  rm text,
  department text,
  account_type text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH investor_base AS (
    SELECT DISTINCT
      i.investor_code AS inv_code,
      i.investor_name,
      i.brokerage_commission,
      i.account_type
    FROM public.investors i
    WHERE (
      NULLIF(_search, '') IS NULL
      OR i.investor_code ILIKE '%' || _search || '%'
      OR i.investor_name ILIKE '%' || _search || '%'
    )
    AND (
      NULLIF(_account_type_filter, '') IS NULL
      OR _account_type_filter = 'all'
      OR UPPER(COALESCE(i.account_type, 'CASH')) = UPPER(_account_type_filter)
    )
  ),
  trade_sums AS (
    SELECT
      th.client_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) AS buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) AS sell_sum
    FROM public.trade_history th
    WHERE th.client_code IN (SELECT inv_code FROM investor_base)
      AND th.fill_type = 'FILL'
      AND (
        (NULLIF(_from_trade_date, '') IS NULL AND NULLIF(_to_trade_date, '') IS NULL)
        OR (
          REPLACE(th.trade_date, '-', '') >= COALESCE(REPLACE(NULLIF(_from_trade_date, ''), '-', ''), '00000000')
          AND REPLACE(th.trade_date, '-', '') <= COALESCE(REPLACE(NULLIF(_to_trade_date, ''), '-', ''), '99999999')
        )
      )
    GROUP BY th.client_code
  ),
  deposit_sums AS (
    SELECT
      dw.investor_code AS inv_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) AS total_withdrawals
    FROM public.deposits_withdrawals dw
    WHERE dw.investor_code IN (SELECT inv_code FROM investor_base)
      AND (
        (NULLIF(_from_tx_date, '') IS NULL AND NULLIF(_to_tx_date, '') IS NULL)
        OR (
          dw.transaction_date >= COALESCE(NULLIF(_from_tx_date, '')::date, date '1900-01-01')
          AND dw.transaction_date <= COALESCE(NULLIF(_to_tx_date, '')::date, date '2100-12-31')
        )
      )
    GROUP BY dw.investor_code
  ),
  rm_assignments AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code AS inv_code,
      ira.rm_name,
      ira.department
    FROM public.investor_rm_assignments ira
    WHERE ira.investor_code IN (SELECT inv_code FROM investor_base)
    ORDER BY ira.investor_code, ira.percentage DESC
  ),
  combined AS (
    SELECT
      ib.inv_code,
      ib.investor_name,
      COALESCE(ra.rm_name, 'Unassigned') AS rm,
      COALESCE(ra.department, 'Unassigned') AS department,
      COALESCE(ib.account_type, 'Cash') AS account_type,
      0::numeric AS opening_balance,
      COALESCE(ds.total_deposits, 0) AS deposits,
      COALESCE(ds.total_withdrawals, 0) AS withdrawals,
      COALESCE(ts.buy_sum, 0) AS gross_buy,
      COALESCE(ts.sell_sum, 0) AS gross_sell,
      (
        0
        + COALESCE(ds.total_deposits, 0)
        - COALESCE(ds.total_withdrawals, 0)
        - COALESCE(ts.buy_sum, 0)
        + COALESCE(ts.sell_sum, 0)
      )::numeric AS closing_balance,
      (
        COALESCE(ds.total_deposits, 0)
        + COALESCE(ds.total_withdrawals, 0)
        + COALESCE(ts.buy_sum, 0)
        + COALESCE(ts.sell_sum, 0)
      ) AS total_activity
    FROM investor_base ib
    LEFT JOIN trade_sums ts ON ib.inv_code = ts.client_code
    LEFT JOIN deposit_sums ds ON ib.inv_code = ds.inv_code
    LEFT JOIN rm_assignments ra ON ib.inv_code = ra.inv_code
  )
  SELECT
    combined.inv_code AS investor_code,
    combined.investor_name,
    combined.rm,
    combined.department,
    combined.account_type,
    combined.opening_balance,
    combined.deposits,
    combined.withdrawals,
    combined.gross_buy,
    combined.gross_sell,
    combined.closing_balance
  FROM combined
  WHERE (
    NULLIF(_has_activity_filter, '') IS NULL
    OR _has_activity_filter = 'all'
    OR (_has_activity_filter = 'with_activity' AND combined.total_activity > 0)
    OR (_has_activity_filter = 'no_activity' AND combined.total_activity = 0)
  )
  ORDER BY combined.inv_code
  LIMIT COALESCE(_limit, 500)
  OFFSET COALESCE(_offset, 0);
END;
$function$;

-- 3) Ensure API roles can execute it
GRANT EXECUTE ON FUNCTION public.get_accounting_data_v2(
  text, text, text, text, text, text, text, integer, integer
) TO anon, authenticated;