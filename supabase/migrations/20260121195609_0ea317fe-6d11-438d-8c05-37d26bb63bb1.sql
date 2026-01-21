-- Fix run_batch_eod to use correct column names and return proper errors
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed integer := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_date_str text;
  v_prev_date date;
BEGIN
  -- Convert date to string format used in trade_history (YYYYMMDD)
  v_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_prev_date := p_eod_date - interval '1 day';

  -- If skip_existing is true and snapshots exist for this date, return early
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1) THEN
      SELECT COUNT(*) INTO v_processed FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'clients_captured', v_processed,
        'message', 'Skipped - snapshots already exist for this date'
      );
    END IF;
  END IF;

  -- Delete existing snapshots for this date (when not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Insert EOD snapshots for all investors
  INSERT INTO eod_ledger_snapshots (
    investor_code,
    investor_name,
    eod_date,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    closing_balance,
    ledger_balance,
    -- Holdings & portfolio fields
    total_stock,
    saleable,
    pending_buy,
    pending_sell,
    total_mv,
    total_cost,
    avg_cost,
    unrealized_pnl,
    -- Settlement fields
    matured_balance,
    receivable_sale,
    cq_in_transit,
    -- Interest & config fields
    accrued_interest,
    cumulative_interest,
    account_type,
    interest_rate,
    brokerage_rate
  )
  SELECT
    inv.investor_code,
    inv.investor_name,
    p_eod_date,
    -- Opening balance: use previous day's closing or investor's ledger_balance as fallback
    COALESCE(prev.closing_balance, inv.ledger_balance, 0) as opening_balance,
    -- Deposits for this date
    COALESCE(dw.deposits, 0) as total_deposits,
    -- Withdrawals for this date
    COALESCE(dw.withdrawals, 0) as total_withdrawals,
    -- Gross buy from trades
    COALESCE(tr.gross_buy, 0) as gross_buy,
    -- Gross sell from trades
    COALESCE(tr.gross_sell, 0) as gross_sell,
    -- Commission calculated as value * (rate/100)
    COALESCE(tr.total_commission, 0) as total_commission,
    -- Closing balance formula
    COALESCE(prev.closing_balance, inv.ledger_balance, 0) 
      + COALESCE(dw.deposits, 0) 
      - COALESCE(dw.withdrawals, 0) 
      + COALESCE(tr.gross_sell, 0) 
      - COALESCE(tr.gross_buy, 0) 
      - COALESCE(tr.total_commission, 0) as closing_balance,
    -- Ledger balance from investor master
    COALESCE(inv.ledger_balance, 0) as ledger_balance,
    -- Holdings fields (from holdings table if available)
    COALESCE(hld.total_stock, 0) as total_stock,
    COALESCE(hld.saleable, 0) as saleable,
    COALESCE(hld.pending_buy, 0) as pending_buy,
    COALESCE(hld.pending_sell, 0) as pending_sell,
    COALESCE(hld.total_mv, 0) as total_mv,
    COALESCE(hld.total_cost, 0) as total_cost,
    COALESCE(hld.avg_cost, 0) as avg_cost,
    COALESCE(hld.total_mv, 0) - COALESCE(hld.total_cost, 0) as unrealized_pnl,
    -- Settlement fields
    COALESCE(hld.matured_balance, 0) as matured_balance,
    COALESCE(hld.receivable_sale, 0) as receivable_sale,
    COALESCE(hld.cq_in_transit, 0) as cq_in_transit,
    -- Interest fields (daily accrual calculation would go here, 0 for now)
    0 as accrued_interest,
    COALESCE(prev.cumulative_interest, 0) as cumulative_interest,
    -- Config snapshot
    inv.account_type,
    inv.interest_rate,
    inv.brokerage_commission as brokerage_rate
  FROM investors inv
  -- Previous day snapshot for opening balance
  LEFT JOIN eod_ledger_snapshots prev 
    ON UPPER(prev.investor_code) = UPPER(inv.investor_code) 
    AND prev.eod_date = v_prev_date
  -- Deposits and withdrawals for this date
  LEFT JOIN (
    SELECT 
      UPPER(client_code) as client_code,
      SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN COALESCE(amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN COALESCE(amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY UPPER(client_code)
  ) dw ON UPPER(dw.client_code) = UPPER(inv.investor_code)
  -- Trades for this date
  LEFT JOIN (
    SELECT 
      UPPER(client_code) as client_code,
      SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      SUM(
        COALESCE(value, 0) * COALESCE(
          (SELECT brokerage_commission FROM investors i WHERE UPPER(i.investor_code) = UPPER(th.client_code) LIMIT 1),
          0.25
        ) / 100
      ) as total_commission
    FROM trade_history th
    WHERE th.trade_date = v_date_str
    GROUP BY UPPER(client_code)
  ) tr ON UPPER(tr.client_code) = UPPER(inv.investor_code)
  -- Holdings aggregation (latest holdings per investor)
  LEFT JOIN (
    SELECT
      UPPER(client_code) as client_code,
      SUM(COALESCE(total_stock, 0)) as total_stock,
      SUM(COALESCE(saleable, 0)) as saleable,
      SUM(COALESCE(pending_buy, 0)) as pending_buy,
      SUM(COALESCE(pending_sell, 0)) as pending_sell,
      SUM(COALESCE(market_value, 0)) as total_mv,
      SUM(COALESCE(total_cost, 0)) as total_cost,
      AVG(COALESCE(avg_cost, 0)) as avg_cost,
      SUM(COALESCE(matured_balance, 0)) as matured_balance,
      SUM(COALESCE(receivable_sale, 0)) as receivable_sale,
      SUM(COALESCE(cq_in_transit, 0)) as cq_in_transit
    FROM holdings
    GROUP BY UPPER(client_code)
  ) hld ON UPPER(hld.client_code) = UPPER(inv.investor_code);

  -- Get counts and totals for the result
  SELECT 
    COUNT(*),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0)
  INTO v_processed, v_gross_buy, v_gross_sell, v_total_commission, v_total_deposits, v_total_withdrawals
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record the EOD run in history
  INSERT INTO eod_run_history (
    run_date,
    run_at,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    status
  )
  SELECT
    p_eod_date,
    now(),
    v_processed,
    COALESCE(SUM(closing_balance), 0),
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'success'
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  RETURN jsonb_build_object(
    'success', true,
    'clients_captured', v_processed,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'date', p_eod_date::text
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE,
    'date', p_eod_date::text
  );
END;
$$;