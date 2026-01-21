
-- Update run_batch_eod to use investors table as the master source instead of clients table
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_errors text[] := ARRAY[]::text[];
  v_start_time timestamptz := clock_timestamp();
BEGIN
  -- If skip_existing is true and records exist for this date, return early
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed', 0,
      'skipped', 0,
      'message', 'Skipped - records already exist for this date',
      'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
    );
  END IF;

  -- Delete existing records for this date (if not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Insert new EOD snapshots
  WITH prev_day AS (
    SELECT investor_code, closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - interval '1 day'
  ),
  -- Use investors table as the single master source (not clients)
  all_investors AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM prev_day
      UNION
      SELECT investor_code FROM investors WHERE investor_code IS NOT NULL AND investor_code != ''
    ) combined
  ),
  base_balances AS (
    SELECT 
      ai.investor_code,
      COALESCE(pd.closing_balance, COALESCE(inv.ledger_balance, 0)) as opening_balance,
      COALESCE(inv.brokerage_commission, 0) as commission_rate,
      COALESCE(inv.interest_rate, 0) as interest_rate
    FROM all_investors ai
    LEFT JOIN prev_day pd ON pd.investor_code = ai.investor_code
    LEFT JOIN investors inv ON inv.investor_code = ai.investor_code
  ),
  daily_transactions AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN COALESCE(amount, 0) ELSE 0 END) as total_deposits,
      SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN COALESCE(amount, 0) ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  daily_trades AS (
    SELECT 
      client_code as investor_code,
      SUM(CASE WHEN UPPER(bs_flag) = 'S' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      SUM(CASE WHEN UPPER(bs_flag) = 'B' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(COALESCE(commission, 0)) as total_commission,
      COUNT(*) as trade_count
    FROM trade_history
    WHERE trade_date = p_eod_date
    GROUP BY client_code
  ),
  daily_holdings AS (
    SELECT 
      h.investor_code,
      SUM(h.quantity * COALESCE(s.close_price, h.avg_cost, 0)) as market_value,
      SUM(h.quantity * COALESCE(h.avg_cost, 0)) as cost_value
    FROM holdings h
    LEFT JOIN securities s ON s.scrip_code = h.scrip_code
    WHERE h.investor_code IS NOT NULL
    GROUP BY h.investor_code
  ),
  accrued_interest AS (
    SELECT 
      bb.investor_code,
      CASE 
        WHEN bb.opening_balance < 0 THEN 
          ABS(bb.opening_balance) * (bb.interest_rate / 100.0 / 365.0)
        ELSE 0
      END as daily_interest
    FROM base_balances bb
  ),
  calculated_balances AS (
    SELECT 
      bb.investor_code,
      bb.opening_balance,
      COALESCE(dt.total_deposits, 0) as deposits,
      COALESCE(dt.total_withdrawals, 0) as withdrawals,
      COALESCE(tr.gross_sell, 0) as gross_sell,
      COALESCE(tr.gross_buy, 0) as gross_buy,
      COALESCE(tr.total_commission, 0) as total_commission,
      COALESCE(tr.trade_count, 0) as trade_count,
      COALESCE(dh.market_value, 0) as market_value,
      COALESCE(dh.cost_value, 0) as cost_value,
      COALESCE(ai.daily_interest, 0) as accrued_interest,
      bb.commission_rate,
      bb.interest_rate,
      -- Closing Balance = Opening + Deposits - Withdrawals + (Gross Sell - Gross Buy - Commission)
      bb.opening_balance 
        + COALESCE(dt.total_deposits, 0) 
        - COALESCE(dt.total_withdrawals, 0)
        + COALESCE(tr.gross_sell, 0) 
        - COALESCE(tr.gross_buy, 0) 
        - COALESCE(tr.total_commission, 0) as closing_balance
    FROM base_balances bb
    LEFT JOIN daily_transactions dt ON dt.investor_code = bb.investor_code
    LEFT JOIN daily_trades tr ON tr.investor_code = bb.investor_code
    LEFT JOIN daily_holdings dh ON dh.investor_code = bb.investor_code
    LEFT JOIN accrued_interest ai ON ai.investor_code = bb.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    opening_balance,
    deposits,
    withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    closing_balance,
    market_value,
    accrued_interest,
    trade_count,
    created_at
  )
  SELECT 
    p_eod_date,
    cb.investor_code,
    cb.opening_balance,
    cb.deposits,
    cb.withdrawals,
    cb.gross_buy,
    cb.gross_sell,
    cb.total_commission,
    cb.closing_balance,
    cb.market_value,
    cb.accrued_interest,
    cb.trade_count,
    now()
  FROM calculated_balances cb;

  GET DIAGNOSTICS v_processed = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', array_append(v_errors, SQLERRM),
    'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
  );
END;
$$;
