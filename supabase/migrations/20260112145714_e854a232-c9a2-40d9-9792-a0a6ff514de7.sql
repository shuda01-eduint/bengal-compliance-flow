
-- Drop existing function overloads first
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,text,text,integer,integer);
DROP FUNCTION IF EXISTS public.get_accounting_data(text,text,text,text,text,text,text,integer,integer,text,text);

-- Create updated function with activity filtering
CREATE OR REPLACE FUNCTION public.get_accounting_data(
  _search_term text DEFAULT NULL,
  _account_type_filter text DEFAULT NULL,
  _has_trades_filter text DEFAULT NULL,
  _from_trade_date text DEFAULT NULL,
  _to_trade_date text DEFAULT NULL,
  _from_tx_date text DEFAULT NULL,
  _to_tx_date text DEFAULT NULL,
  _page_size integer DEFAULT 50,
  _page_offset integer DEFAULT 0,
  _sort_column text DEFAULT 'investor_code',
  _sort_direction text DEFAULT 'asc'
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  account_type text,
  brokerage_commission numeric,
  interest_rate numeric,
  ledger_balance numeric,
  gross_buy numeric,
  gross_sell numeric,
  net_buy numeric,
  net_sell numeric,
  brokerage_amount numeric,
  adjusted_ledger numeric,
  accrued_interest numeric,
  final_balance numeric,
  receivable numeric,
  payable numeric,
  total_deposits numeric,
  total_withdrawals numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_trade timestamp with time zone;
  _to_trade timestamp with time zone;
  _from_tx timestamp with time zone;
  _to_tx timestamp with time zone;
BEGIN
  -- Parse date parameters
  _from_trade := CASE WHEN _from_trade_date IS NOT NULL THEN _from_trade_date::timestamp with time zone ELSE NULL END;
  _to_trade := CASE WHEN _to_trade_date IS NOT NULL THEN (_to_trade_date::date + interval '1 day' - interval '1 second')::timestamp with time zone ELSE NULL END;
  _from_tx := CASE WHEN _from_tx_date IS NOT NULL THEN _from_tx_date::timestamp with time zone ELSE NULL END;
  _to_tx := CASE WHEN _to_tx_date IS NOT NULL THEN (_to_tx_date::date + interval '1 day' - interval '1 second')::timestamp with time zone ELSE NULL END;

  RETURN QUERY
  WITH trade_sums AS (
    SELECT 
      UPPER(th.client_code) as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN th.value ELSE 0 END), 0) as buy_sum,
      COALESCE(SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN th.value ELSE 0 END), 0) as sell_sum
    FROM trade_history th
    WHERE th.client_code IS NOT NULL
      AND (_from_trade IS NULL OR th.trade_date::timestamp with time zone >= _from_trade)
      AND (_to_trade IS NULL OR th.trade_date::timestamp with time zone <= _to_trade)
    GROUP BY UPPER(th.client_code)
  ),
  deposit_sums AS (
    SELECT 
      UPPER(dw.investor_code) as inv_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE (_from_tx IS NULL OR dw.transaction_date::timestamp with time zone >= _from_tx)
      AND (_to_tx IS NULL OR dw.transaction_date::timestamp with time zone <= _to_tx)
    GROUP BY UPPER(dw.investor_code)
  ),
  investor_data AS (
    SELECT 
      i.investor_code as inv_code,
      i.investor_name as inv_name,
      i.account_type as acc_type,
      COALESCE(i.brokerage_commission, 0) as commission_rate,
      COALESCE(i.interest_rate, 0) as int_rate
    FROM investors i
    WHERE i.status IS NULL OR UPPER(i.status) != 'CLOSED'
  ),
  client_balances AS (
    SELECT 
      UPPER(c.inv_code) as inv_code,
      COALESCE(c.ledger_balance, 0) as ledger,
      COALESCE(c.accrued_interest, 0) as interest
    FROM clients c
  ),
  combined AS (
    SELECT
      id.inv_code,
      id.inv_name,
      id.acc_type,
      id.commission_rate,
      id.int_rate,
      COALESCE(cb.ledger, 0) as ledger_bal,
      COALESCE(cb.interest, 0) as accrued_int,
      COALESCE(ts.buy_sum, 0) as buy_val,
      COALESCE(ts.sell_sum, 0) as sell_val,
      COALESCE(ds.deposits, 0) as dep_val,
      COALESCE(ds.withdrawals, 0) as wd_val
    FROM investor_data id
    LEFT JOIN client_balances cb ON UPPER(id.inv_code) = cb.inv_code
    LEFT JOIN trade_sums ts ON UPPER(id.inv_code) = ts.inv_code
    LEFT JOIN deposit_sums ds ON UPPER(id.inv_code) = ds.inv_code
    WHERE 
      -- Search filter
      (_search_term IS NULL OR _search_term = '' OR 
        UPPER(id.inv_code) LIKE '%' || UPPER(_search_term) || '%' OR
        UPPER(id.inv_name) LIKE '%' || UPPER(_search_term) || '%')
      -- Account type filter
      AND (_account_type_filter IS NULL OR _account_type_filter = 'all' OR 
        UPPER(COALESCE(id.acc_type, '')) = UPPER(_account_type_filter))
      -- Activity filter - now includes deposits/withdrawals
      AND (_has_trades_filter IS NULL OR _has_trades_filter = 'all'
        OR (_has_trades_filter = 'with_activity' AND (
            COALESCE(ts.buy_sum, 0) > 0 
            OR COALESCE(ts.sell_sum, 0) > 0
            OR COALESCE(ds.deposits, 0) > 0 
            OR COALESCE(ds.withdrawals, 0) > 0
          ))
        OR (_has_trades_filter = 'with_trades' AND (
            COALESCE(ts.buy_sum, 0) > 0 
            OR COALESCE(ts.sell_sum, 0) > 0
          ))
        OR (_has_trades_filter = 'no_activity' AND 
            COALESCE(ts.buy_sum, 0) = 0 
            AND COALESCE(ts.sell_sum, 0) = 0
            AND COALESCE(ds.deposits, 0) = 0 
            AND COALESCE(ds.withdrawals, 0) = 0
          )
      )
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM combined
  ),
  final_data AS (
    SELECT
      c.inv_code,
      c.inv_name,
      c.acc_type,
      c.commission_rate,
      c.int_rate,
      c.ledger_bal,
      c.buy_val,
      c.sell_val,
      -- Net values after commission
      c.buy_val * (1 + c.commission_rate / 100) as net_buy_val,
      c.sell_val * (1 - c.commission_rate / 100) as net_sell_val,
      -- Brokerage amount
      (c.buy_val + c.sell_val) * c.commission_rate / 100 as brokerage,
      c.accrued_int,
      c.dep_val,
      c.wd_val,
      (SELECT cnt FROM counted) as total_cnt
    FROM combined c
  )
  SELECT
    fd.inv_code::text as investor_code,
    fd.inv_name::text as investor_name,
    fd.acc_type::text as account_type,
    fd.commission_rate as brokerage_commission,
    fd.int_rate as interest_rate,
    fd.ledger_bal as ledger_balance,
    fd.buy_val as gross_buy,
    fd.sell_val as gross_sell,
    fd.net_buy_val as net_buy,
    fd.net_sell_val as net_sell,
    fd.brokerage as brokerage_amount,
    -- Adjusted ledger = ledger + net_sell - net_buy
    fd.ledger_bal + fd.net_sell_val - fd.net_buy_val as adjusted_ledger,
    fd.accrued_int as accrued_interest,
    -- Final balance = adjusted_ledger - accrued_interest
    fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int as final_balance,
    -- Receivable (positive final balance)
    GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0) as receivable,
    -- Payable (negative final balance as positive)
    GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0) as payable,
    fd.dep_val as total_deposits,
    fd.wd_val as total_withdrawals,
    fd.total_cnt as total_count
  FROM final_data fd
  ORDER BY
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN fd.inv_code
        WHEN 'investor_name' THEN fd.inv_name
        WHEN 'account_type' THEN fd.acc_type
        ELSE fd.inv_code
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'investor_code' THEN fd.inv_code
        WHEN 'investor_name' THEN fd.inv_name
        WHEN 'account_type' THEN fd.acc_type
        ELSE fd.inv_code
      END
    END DESC NULLS LAST,
    CASE WHEN _sort_direction = 'asc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN fd.ledger_bal
        WHEN 'gross_buy' THEN fd.buy_val
        WHEN 'gross_sell' THEN fd.sell_val
        WHEN 'brokerage_amount' THEN fd.brokerage
        WHEN 'adjusted_ledger' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val
        WHEN 'final_balance' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int
        WHEN 'receivable' THEN GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0)
        WHEN 'payable' THEN GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0)
        ELSE NULL
      END
    END ASC NULLS LAST,
    CASE WHEN _sort_direction = 'desc' THEN
      CASE _sort_column
        WHEN 'ledger_balance' THEN fd.ledger_bal
        WHEN 'gross_buy' THEN fd.buy_val
        WHEN 'gross_sell' THEN fd.sell_val
        WHEN 'brokerage_amount' THEN fd.brokerage
        WHEN 'adjusted_ledger' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val
        WHEN 'final_balance' THEN fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int
        WHEN 'receivable' THEN GREATEST(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int, 0)
        WHEN 'payable' THEN GREATEST(-(fd.ledger_bal + fd.net_sell_val - fd.net_buy_val - fd.accrued_int), 0)
        ELSE NULL
      END
    END DESC NULLS LAST
  LIMIT _page_size
  OFFSET _page_offset;
END;
$$;
