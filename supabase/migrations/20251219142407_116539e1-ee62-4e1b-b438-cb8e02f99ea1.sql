
-- Create covering index for faster keyset pagination
CREATE INDEX IF NOT EXISTS idx_balances_raw_date_id_covering 
ON balances_raw (as_of_date, id) 
INCLUDE (investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_mv, 
         ledger_balance, matured_balance, receivable_sale, cq_in_transit, rm_id, rm_name, rm_email);

-- Create optimized RPC function for admin balances with server-side enrichment
CREATE OR REPLACE FUNCTION get_admin_balances_enriched(
  p_date date,
  p_rm_email text DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  as_of_date date,
  investor_code text,
  instrument text,
  total_stock integer,
  saleable integer,
  avg_cost numeric,
  total_cost numeric,
  total_mv numeric,
  ledger_balance numeric,
  matured_balance numeric,
  receivable_sale numeric,
  cq_in_transit numeric,
  rm_id text,
  rm_name text,
  rm_email text,
  -- Enriched fields computed server-side
  unrealized_pnl numeric,
  pnl_pct numeric,
  net_available numeric,
  risk_flag text,
  adjusted_ledger numeric,
  deposits numeric,
  withdrawals numeric,
  net_sell numeric,
  net_buy numeric,
  gross_buy numeric,
  gross_sell numeric,
  brokerage_amount numeric,
  accrued_interest numeric,
  receivable_payable numeric,
  brokerage_commission_rate numeric,
  interest_rate numeric,
  account_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_day date := p_date + interval '1 day';
  latest_trade_date date;
BEGIN
  -- Get latest trade date
  SELECT MAX(trade_date::date) INTO latest_trade_date FROM trade_history WHERE trade_date IS NOT NULL;

  RETURN QUERY
  WITH 
  -- Aggregate deposits/withdrawals for the next day
  tx_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = next_day
    GROUP BY dw.investor_code
  ),
  -- Aggregate trades from latest trade date
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as gross_buy
    FROM trade_history th
    WHERE th.trade_date = latest_trade_date::text AND th.client_code IS NOT NULL
    GROUP BY th.client_code
  ),
  -- Get investor data for calculations
  investor_info AS (
    SELECT 
      i.investor_code,
      COALESCE(i.interest_rate, 0) as interest_rate,
      COALESCE(i.brokerage_commission, 0) as brokerage_commission,
      i.account_type
    FROM investors i
  )
  SELECT 
    br.id,
    br.as_of_date,
    br.investor_code,
    br.instrument,
    br.total_stock,
    br.saleable,
    br.avg_cost,
    br.total_cost,
    br.total_mv,
    br.ledger_balance,
    br.matured_balance,
    br.receivable_sale,
    br.cq_in_transit,
    br.rm_id,
    br.rm_name,
    br.rm_email,
    -- Computed enriched fields
    COALESCE(br.total_mv, 0) - COALESCE(br.total_cost, 0) as unrealized_pnl,
    CASE 
      WHEN COALESCE(br.total_cost, 0) > 0 
      THEN ((COALESCE(br.total_mv, 0) - COALESCE(br.total_cost, 0)) / br.total_cost) * 100
      ELSE NULL 
    END as pnl_pct,
    COALESCE(br.ledger_balance, 0) + COALESCE(br.matured_balance, 0) + COALESCE(br.receivable_sale, 0) as net_available,
    -- Risk flag calculation
    CASE 
      WHEN (COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
            + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
            - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0)) < -100000 
        OR (COALESCE(br.total_cost, 0) > 0 AND 
            ((COALESCE(br.total_mv, 0) - COALESCE(br.total_cost, 0)) / br.total_cost) * 100 < -30)
      THEN 'High'
      WHEN (COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
            + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
            - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0)) < 0 
        OR (COALESCE(br.total_cost, 0) > 0 AND 
            ((COALESCE(br.total_mv, 0) - COALESCE(br.total_cost, 0)) / br.total_cost) * 100 < -15)
      THEN 'Watch'
      ELSE 'OK'
    END as risk_flag,
    -- Adjusted ledger (next day projection)
    COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
      + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
      - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0) as adjusted_ledger,
    COALESCE(tx.deposits, 0) as deposits,
    COALESCE(tx.withdrawals, 0) as withdrawals,
    COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) as net_sell,
    COALESCE(t.gross_buy, 0) - COALESCE(t.gross_sell, 0) as net_buy,
    COALESCE(t.gross_buy, 0) as gross_buy,
    COALESCE(t.gross_sell, 0) as gross_sell,
    (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0) as brokerage_amount,
    -- Accrued interest (only for margin accounts with negative adjusted ledger)
    CASE 
      WHEN LOWER(COALESCE(inv.account_type, '')) = 'margin' 
           AND (COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
                + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
                - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0)) < 0
      THEN ABS(COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
               + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
               - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0)) 
           * COALESCE(inv.interest_rate, 0) / 365 / 100
      ELSE 0
    END as accrued_interest,
    -- Receivable/Payable
    CASE 
      WHEN COALESCE(t.gross_sell, 0) > COALESCE(t.gross_buy, 0)
      THEN COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0)
      ELSE COALESCE(t.gross_buy, 0) - COALESCE(t.gross_sell, 0)
    END as receivable_payable,
    COALESCE(inv.brokerage_commission, 0) as brokerage_commission_rate,
    COALESCE(inv.interest_rate, 0) as interest_rate,
    inv.account_type
  FROM balances_raw br
  LEFT JOIN tx_agg tx ON tx.investor_code = br.investor_code
  LEFT JOIN trade_agg t ON t.investor_code = br.investor_code
  LEFT JOIN investor_info inv ON inv.investor_code = br.investor_code
  WHERE br.as_of_date = p_date
    AND (p_rm_email IS NULL OR LOWER(br.rm_email) = LOWER(p_rm_email))
    AND (p_cursor_id IS NULL OR br.id > p_cursor_id)
  ORDER BY br.id
  LIMIT p_limit;
END;
$$;

-- Create summary function for KPI cards (much faster than client-side aggregation)
CREATE OR REPLACE FUNCTION get_admin_balances_summary(
  p_date date,
  p_rm_email text DEFAULT NULL
)
RETURNS TABLE (
  total_clients bigint,
  total_mv_sum numeric,
  total_cost_sum numeric,
  unrealized_pnl_sum numeric,
  negative_ledger_count bigint,
  receivable_sum numeric,
  cq_sum numeric,
  total_accrued_interest numeric,
  total_margin_loan numeric,
  total_brokerage numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_day date := p_date + interval '1 day';
  latest_trade_date date;
BEGIN
  -- Get latest trade date
  SELECT MAX(trade_date::date) INTO latest_trade_date FROM trade_history WHERE trade_date IS NOT NULL;

  RETURN QUERY
  WITH 
  tx_agg AS (
    SELECT 
      dw.investor_code,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Deposit' THEN dw.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN dw.transaction_type = 'Withdrawal' THEN dw.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = next_day
    GROUP BY dw.investor_code
  ),
  trade_agg AS (
    SELECT 
      th.client_code as investor_code,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('S', 'SELL') THEN th.value ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('B', 'BUY') THEN th.value ELSE 0 END), 0) as gross_buy
    FROM trade_history th
    WHERE th.trade_date = latest_trade_date::text AND th.client_code IS NOT NULL
    GROUP BY th.client_code
  ),
  investor_info AS (
    SELECT 
      i.investor_code,
      COALESCE(i.interest_rate, 0) as interest_rate,
      COALESCE(i.brokerage_commission, 0) as brokerage_commission,
      i.account_type
    FROM investors i
  ),
  enriched AS (
    SELECT 
      br.investor_code,
      br.total_mv,
      br.total_cost,
      br.receivable_sale,
      br.cq_in_transit,
      br.ledger_balance,
      COALESCE(tx.deposits, 0) as deposits,
      COALESCE(tx.withdrawals, 0) as withdrawals,
      COALESCE(t.gross_sell, 0) as gross_sell,
      COALESCE(t.gross_buy, 0) as gross_buy,
      COALESCE(inv.brokerage_commission, 0) as brokerage_commission,
      COALESCE(inv.interest_rate, 0) as interest_rate,
      inv.account_type,
      -- Adjusted ledger
      COALESCE(br.ledger_balance, 0) + COALESCE(tx.deposits, 0) - COALESCE(tx.withdrawals, 0) 
        + COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0) 
        - (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0) as adjusted_ledger
    FROM balances_raw br
    LEFT JOIN tx_agg tx ON tx.investor_code = br.investor_code
    LEFT JOIN trade_agg t ON t.investor_code = br.investor_code
    LEFT JOIN investor_info inv ON inv.investor_code = br.investor_code
    WHERE br.as_of_date = p_date
      AND (p_rm_email IS NULL OR LOWER(br.rm_email) = LOWER(p_rm_email))
  ),
  investor_summary AS (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      adjusted_ledger,
      account_type,
      interest_rate,
      brokerage_commission,
      gross_buy,
      gross_sell
    FROM enriched
  )
  SELECT 
    COUNT(DISTINCT e.investor_code)::bigint as total_clients,
    COALESCE(SUM(e.total_mv), 0) as total_mv_sum,
    COALESCE(SUM(e.total_cost), 0) as total_cost_sum,
    COALESCE(SUM(e.total_mv), 0) - COALESCE(SUM(e.total_cost), 0) as unrealized_pnl_sum,
    (SELECT COUNT(*) FROM investor_summary WHERE adjusted_ledger < 0)::bigint as negative_ledger_count,
    COALESCE(SUM(e.receivable_sale), 0) as receivable_sum,
    COALESCE(SUM(e.cq_in_transit), 0) as cq_sum,
    -- Total accrued interest (for margin accounts with negative adjusted ledger)
    COALESCE((
      SELECT SUM(
        CASE 
          WHEN LOWER(COALESCE(account_type, '')) = 'margin' AND adjusted_ledger < 0
          THEN ABS(adjusted_ledger) * interest_rate / 365 / 100
          ELSE 0
        END
      )
      FROM investor_summary
    ), 0) as total_accrued_interest,
    -- Total margin loan (sum of negative adjusted ledgers for margin accounts)
    COALESCE((
      SELECT SUM(ABS(adjusted_ledger))
      FROM investor_summary
      WHERE LOWER(COALESCE(account_type, '')) = 'margin' AND adjusted_ledger < 0
    ), 0) as total_margin_loan,
    -- Total brokerage
    COALESCE((
      SELECT SUM((gross_buy + gross_sell) * brokerage_commission)
      FROM investor_summary
    ), 0) as total_brokerage
  FROM enriched e;
END;
$$;
