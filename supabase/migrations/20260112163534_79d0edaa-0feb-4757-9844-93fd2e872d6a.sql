-- Drop and recreate get_accounting_data with correct signature
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, text, text, text, integer, integer, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_data;

CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0,
  _account_type_filter text DEFAULT 'all',
  _has_trades_filter text DEFAULT 'with_activity',
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc'
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  interest_rate numeric,
  brokerage_commission numeric,
  ledger_balance numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  net_buy numeric,
  net_sell numeric,
  adjusted_ledger numeric,
  accrued_interest numeric,
  receivable numeric,
  payable numeric,
  brokerage_amount numeric,
  final_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_query text;
  count_query text;
  full_query text;
  row_count bigint;
BEGIN
  -- First get total count with same filters
  count_query := '
    SELECT COUNT(DISTINCT i.investor_code)
    FROM investors i
    WHERE 1=1
  ';

  -- Search filter
  IF _search_term IS NOT NULL AND _search_term != '' THEN
    count_query := count_query || ' AND (i.investor_code ILIKE ''%' || _search_term || '%'' OR i.investor_name ILIKE ''%' || _search_term || '%'')';
  END IF;

  -- Account type filter
  IF _account_type_filter IS NOT NULL AND _account_type_filter != 'all' THEN
    count_query := count_query || ' AND i.account_type = ''' || _account_type_filter || '''';
  END IF;

  -- Activity filter - only show investors with trades or deposits/withdrawals in range
  IF _has_trades_filter = 'with_activity' THEN
    count_query := count_query || ' AND (
      EXISTS (
        SELECT 1 FROM trade_history th
        WHERE th.client_code = i.investor_code
        AND th.trade_date >= ''' || COALESCE(_from_trade_date, '19000101') || '''
        AND th.trade_date <= ''' || COALESCE(_to_trade_date, '99991231') || '''
      )
      OR EXISTS (
        SELECT 1 FROM deposits_withdrawals dw
        WHERE dw.investor_code = i.investor_code
        AND dw.transaction_date::date >= ''' || COALESCE(_from_tx_date, '1900-01-01') || '''::date
        AND dw.transaction_date::date <= ''' || COALESCE(_to_tx_date, '9999-12-31') || '''::date
      )
    )';
  END IF;

  EXECUTE count_query INTO row_count;

  -- Main data query
  base_query := '
    SELECT
      i.investor_code,
      i.investor_name,
      COALESCE(i.account_type, ''Regular'') as account_type,
      COALESCE(i.interest_rate, 0)::numeric as interest_rate,
      COALESCE(i.brokerage_commission, 0)::numeric as brokerage_commission,
      COALESCE(i.ledger_balance, 0)::numeric as ledger_balance,
      COALESCE(dw_agg.deposits, 0)::numeric as total_deposits,
      COALESCE(dw_agg.withdrawals, 0)::numeric as total_withdrawals,
      COALESCE(th_agg.net_buy, 0)::numeric as net_buy,
      COALESCE(th_agg.net_sell, 0)::numeric as net_sell,
      (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0))::numeric as adjusted_ledger,
      CASE
        WHEN i.account_type = ''Margin'' AND (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) < 0
        THEN ABS(COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) * COALESCE(i.interest_rate, 0) / 100 / 365
        ELSE 0
      END::numeric as accrued_interest,
      CASE
        WHEN (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) > 0
        THEN (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0))
        ELSE 0
      END::numeric as receivable,
      CASE
        WHEN (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) < 0
        THEN ABS(COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0))
        ELSE 0
      END::numeric as payable,
      (COALESCE(th_agg.gross_buy, 0) * COALESCE(i.brokerage_commission, 0) / 100)::numeric as brokerage_amount,
      (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0) -
       CASE
         WHEN i.account_type = ''Margin'' AND (COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) < 0
         THEN ABS(COALESCE(i.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0)) * COALESCE(i.interest_rate, 0) / 100 / 365
         ELSE 0
       END)::numeric as final_balance,
      COALESCE(th_agg.gross_buy, 0)::numeric as gross_buy,
      COALESCE(th_agg.gross_sell, 0)::numeric as gross_sell,
      ' || row_count || '::bigint as total_count
    FROM investors i
    LEFT JOIN (
      SELECT
        th.client_code,
        SUM(CASE WHEN th.buy_sell = ''B'' THEN th.total_cost ELSE 0 END) as net_buy,
        SUM(CASE WHEN th.buy_sell = ''S'' THEN th.total_cost ELSE 0 END) as net_sell,
        SUM(CASE WHEN th.buy_sell = ''B'' THEN th.value ELSE 0 END) as gross_buy,
        SUM(CASE WHEN th.buy_sell = ''S'' THEN th.value ELSE 0 END) as gross_sell
      FROM trade_history th
      WHERE th.trade_date >= ''' || COALESCE(_from_trade_date, '19000101') || '''
        AND th.trade_date <= ''' || COALESCE(_to_trade_date, '99991231') || '''
      GROUP BY th.client_code
    ) th_agg ON th_agg.client_code = i.investor_code
    LEFT JOIN (
      SELECT
        dw.investor_code,
        SUM(CASE WHEN dw.transaction_type = ''Deposit'' THEN dw.amount ELSE 0 END) as deposits,
        SUM(CASE WHEN dw.transaction_type = ''Withdrawal'' THEN dw.amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals dw
      WHERE dw.transaction_date::date >= ''' || COALESCE(_from_tx_date, '1900-01-01') || '''::date
        AND dw.transaction_date::date <= ''' || COALESCE(_to_tx_date, '9999-12-31') || '''::date
      GROUP BY dw.investor_code
    ) dw_agg ON dw_agg.investor_code = i.investor_code
    WHERE 1=1
  ';

  -- Search filter
  IF _search_term IS NOT NULL AND _search_term != '' THEN
    base_query := base_query || ' AND (i.investor_code ILIKE ''%' || _search_term || '%'' OR i.investor_name ILIKE ''%' || _search_term || '%'')';
  END IF;

  -- Account type filter
  IF _account_type_filter IS NOT NULL AND _account_type_filter != 'all' THEN
    base_query := base_query || ' AND i.account_type = ''' || _account_type_filter || '''';
  END IF;

  -- Activity filter
  IF _has_trades_filter = 'with_activity' THEN
    base_query := base_query || ' AND (th_agg.client_code IS NOT NULL OR dw_agg.investor_code IS NOT NULL)';
  END IF;

  -- Sorting
  base_query := base_query || ' ORDER BY ' || _sort_column || ' ' || _sort_direction;

  -- Pagination
  IF _page_size > 0 THEN
    base_query := base_query || ' LIMIT ' || _page_size || ' OFFSET ' || _page_offset;
  END IF;

  RETURN QUERY EXECUTE base_query;
END;
$$;

-- Drop and recreate get_accounting_summary with correct signature
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_accounting_summary;

CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  _search_term text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _account_type_filter text DEFAULT 'all',
  _has_trades_filter text DEFAULT 'with_activity'
)
RETURNS TABLE (
  total_accounts bigint,
  margin_accounts bigint,
  total_margin_loan numeric,
  total_accrued_interest numeric,
  total_receivable numeric,
  total_payable numeric,
  total_buy numeric,
  total_sell numeric,
  total_trade_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_investors AS (
    SELECT i.*
    FROM investors i
    WHERE (
      _search_term IS NULL OR _search_term = '' OR
      i.investor_code ILIKE '%' || _search_term || '%' OR
      i.investor_name ILIKE '%' || _search_term || '%'
    )
    AND (
      _account_type_filter IS NULL OR _account_type_filter = 'all' OR
      i.account_type = _account_type_filter
    )
    AND (
      _has_trades_filter != 'with_activity' OR
      EXISTS (
        SELECT 1 FROM trade_history th
        WHERE th.client_code = i.investor_code
        AND th.trade_date >= COALESCE(_from_trade_date, '19000101')
        AND th.trade_date <= COALESCE(_to_trade_date, '99991231')
      )
      OR EXISTS (
        SELECT 1 FROM deposits_withdrawals dw
        WHERE dw.investor_code = i.investor_code
        AND dw.transaction_date::date >= COALESCE(_from_tx_date, '1900-01-01')::date
        AND dw.transaction_date::date <= COALESCE(_to_tx_date, '9999-12-31')::date
      )
    )
  ),
  investor_data AS (
    SELECT
      fi.investor_code,
      fi.account_type,
      fi.interest_rate,
      COALESCE(fi.ledger_balance, 0) as ledger_balance,
      COALESCE(th_agg.net_buy, 0) as net_buy,
      COALESCE(th_agg.net_sell, 0) as net_sell,
      COALESCE(dw_agg.deposits, 0) as deposits,
      COALESCE(dw_agg.withdrawals, 0) as withdrawals,
      COALESCE(fi.ledger_balance, 0) + COALESCE(dw_agg.deposits, 0) - COALESCE(dw_agg.withdrawals, 0) - COALESCE(th_agg.net_buy, 0) + COALESCE(th_agg.net_sell, 0) as adjusted_ledger
    FROM filtered_investors fi
    LEFT JOIN (
      SELECT
        th.client_code,
        SUM(CASE WHEN th.buy_sell = 'B' THEN th.total_cost ELSE 0 END) as net_buy,
        SUM(CASE WHEN th.buy_sell = 'S' THEN th.total_cost ELSE 0 END) as net_sell
      FROM trade_history th
      WHERE th.trade_date >= COALESCE(_from_trade_date, '19000101')
        AND th.trade_date <= COALESCE(_to_trade_date, '99991231')
      GROUP BY th.client_code
    ) th_agg ON th_agg.client_code = fi.investor_code
    LEFT JOIN (
      SELECT
        dw.investor_code,
        SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END) as deposits,
        SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals dw
      WHERE dw.transaction_date::date >= COALESCE(_from_tx_date, '1900-01-01')::date
        AND dw.transaction_date::date <= COALESCE(_to_tx_date, '9999-12-31')::date
      GROUP BY dw.investor_code
    ) dw_agg ON dw_agg.investor_code = fi.investor_code
    WHERE (_has_trades_filter != 'with_activity' OR th_agg.client_code IS NOT NULL OR dw_agg.investor_code IS NOT NULL)
  )
  SELECT
    COUNT(*)::bigint as total_accounts,
    COUNT(*) FILTER (WHERE id.account_type = 'Margin')::bigint as margin_accounts,
    SUM(CASE WHEN id.account_type = 'Margin' AND id.adjusted_ledger < 0 THEN ABS(id.adjusted_ledger) ELSE 0 END)::numeric as total_margin_loan,
    SUM(CASE WHEN id.account_type = 'Margin' AND id.adjusted_ledger < 0 THEN ABS(id.adjusted_ledger) * COALESCE(id.interest_rate, 0) / 100 / 365 ELSE 0 END)::numeric as total_accrued_interest,
    SUM(CASE WHEN id.adjusted_ledger > 0 THEN id.adjusted_ledger ELSE 0 END)::numeric as total_receivable,
    SUM(CASE WHEN id.adjusted_ledger < 0 THEN ABS(id.adjusted_ledger) ELSE 0 END)::numeric as total_payable,
    SUM(id.net_buy)::numeric as total_buy,
    SUM(id.net_sell)::numeric as total_sell,
    (SUM(id.net_buy) + SUM(id.net_sell))::numeric as total_trade_value
  FROM investor_data id;
END;
$$;