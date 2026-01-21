CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count integer := 0;
  v_skipped_count integer := 0;
  v_error_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_start_time timestamp;
  v_end_time timestamp;
BEGIN
  v_start_time := clock_timestamp();

  -- If skip_existing is true and data exists for this date, skip
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1) THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Skipped - data already exists for this date',
        'inserted_count', 0,
        'skipped_count', 1,
        'error_count', 0,
        'errors', '[]'::jsonb,
        'execution_time_ms', 0
      );
    END IF;
  END IF;

  -- Delete existing records for this date (if not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Insert EOD snapshots for all investors
  INSERT INTO eod_ledger_snapshots (
    investor_code,
    eod_date,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    closing_balance,
    total_stock,
    saleable,
    pending_buy,
    pending_sell,
    total_mv,
    total_cost,
    avg_cost,
    unrealized_pnl,
    matured_balance,
    receivable_sale,
    cq_in_transit
  )
  SELECT
    inv.investor_code,
    p_eod_date,
    -- Opening balance: previous day closing OR ledger_balance as baseline
    COALESCE(prev.closing_balance, inv.ledger_balance, 0) as opening_balance,
    -- Deposits for the day
    COALESCE(dw.deposits, 0) as total_deposits,
    -- Withdrawals for the day
    COALESCE(dw.withdrawals, 0) as total_withdrawals,
    -- Gross buy from trades
    COALESCE(tr.gross_buy, 0) as gross_buy,
    -- Gross sell from trades
    COALESCE(tr.gross_sell, 0) as gross_sell,
    -- Commission calculated as value * (rate / 100)
    COALESCE(tr.gross_buy + tr.gross_sell, 0) * COALESCE(inv.commission_rate, 0) / 100 as total_commission,
    -- Closing balance = opening + deposits - withdrawals + (sell - buy - commission)
    COALESCE(prev.closing_balance, inv.ledger_balance, 0) 
      + COALESCE(dw.deposits, 0) 
      - COALESCE(dw.withdrawals, 0) 
      + COALESCE(tr.gross_sell, 0) 
      - COALESCE(tr.gross_buy, 0) 
      - (COALESCE(tr.gross_buy + tr.gross_sell, 0) * COALESCE(inv.commission_rate, 0) / 100) as closing_balance,
    -- Holdings data
    COALESCE(hld.total_stock, 0) as total_stock,
    COALESCE(hld.saleable, 0) as saleable,
    COALESCE(hld.pending_buy, 0) as pending_buy,
    COALESCE(hld.pending_sell, 0) as pending_sell,
    COALESCE(hld.total_mv, 0) as total_mv,
    COALESCE(hld.total_cost, 0) as total_cost,
    COALESCE(hld.avg_cost, 0) as avg_cost,
    -- Unrealized PnL = Market Value - Total Cost
    COALESCE(hld.total_mv, 0) - COALESCE(hld.total_cost, 0) as unrealized_pnl,
    COALESCE(hld.matured_balance, 0) as matured_balance,
    COALESCE(hld.receivable_sale, 0) as receivable_sale,
    COALESCE(hld.cq_in_transit, 0) as cq_in_transit
  FROM investors inv
  -- Previous day's closing balance
  LEFT JOIN eod_ledger_snapshots prev 
    ON UPPER(prev.investor_code) = UPPER(inv.investor_code) 
    AND prev.eod_date = p_eod_date - INTERVAL '1 day'
  -- Deposits and withdrawals for the day
  LEFT JOIN (
    SELECT 
      UPPER(investor_code) as inv_code,
      SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN COALESCE(amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN COALESCE(amount, 0) ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY UPPER(investor_code)
  ) dw ON UPPER(dw.inv_code) = UPPER(inv.investor_code)
  -- Trades for the day
  LEFT JOIN (
    SELECT
      UPPER(client_code) as inv_code,
      SUM(CASE WHEN UPPER(side) = 'BUY' OR UPPER(side) = 'B' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(side) = 'SELL' OR UPPER(side) = 'S' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell
    FROM trade_history
    WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD')
    GROUP BY UPPER(client_code)
  ) tr ON UPPER(tr.inv_code) = UPPER(inv.investor_code)
  -- Holdings snapshot (using investor_code, defaulting missing columns to 0)
  LEFT JOIN (
    SELECT
      UPPER(investor_code) as inv_code,
      SUM(COALESCE(total_stock, 0)) as total_stock,
      SUM(COALESCE(saleable, 0)) as saleable,
      0 as pending_buy,
      0 as pending_sell,
      SUM(COALESCE(market_value, 0)) as total_mv,
      SUM(COALESCE(total_cost, 0)) as total_cost,
      AVG(COALESCE(avg_cost, 0)) as avg_cost,
      0 as matured_balance,
      0 as receivable_sale,
      0 as cq_in_transit
    FROM holdings
    GROUP BY UPPER(investor_code)
  ) hld ON UPPER(hld.inv_code) = UPPER(inv.investor_code);

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  v_end_time := clock_timestamp();

  RETURN jsonb_build_object(
    'success', true,
    'message', format('EOD batch completed for %s', p_eod_date),
    'inserted_count', v_inserted_count,
    'skipped_count', v_skipped_count,
    'error_count', v_error_count,
    'errors', v_errors,
    'execution_time_ms', EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::integer
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', format('EOD batch failed: %s', SQLERRM),
    'error_detail', SQLSTATE,
    'inserted_count', 0,
    'skipped_count', 0,
    'error_count', 1,
    'errors', jsonb_build_array(SQLERRM),
    'execution_time_ms', 0
  );
END;
$$;