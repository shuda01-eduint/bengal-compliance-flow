-- Fix column reference: trade_file has qty and price, not value
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
SET lock_timeout = '120s'
AS $$
DECLARE
  v_trade_count INT := 0;
  v_investor_count INT := 0;
  v_snapshot_count INT := 0;
  v_position_count INT := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_deposit_count INT := 0;
  v_withdrawal_count INT := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_instruments_priced INT := 0;
  v_total_market_value NUMERIC := 0;
  v_margin_accounts INT := 0;
  v_margin_exposure NUMERIC := 0;
  v_daily_interest_total NUMERIC := 0;
  v_cumulative_interest_total NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_negative_equity_count INT := 0;
  v_with_rm_assigned INT := 0;
  v_with_department INT := 0;
  v_prev_date DATE;
  v_deleted_snapshots INT := 0;
  v_deleted_positions INT := 0;
  v_deleted_history INT := 0;
BEGIN
  -- Acquire advisory lock to prevent concurrent runs
  IF NOT pg_try_advisory_xact_lock(hashtext('process_staged_trades_' || p_trade_date::text)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Another EOD process is running for this date',
      'error_detail', 'Please wait for the current process to complete'
    );
  END IF;

  v_prev_date := p_trade_date - INTERVAL '1 day';

  -- STEP 1: Clear existing EOD data for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  GET DIAGNOSTICS v_deleted_snapshots = ROW_COUNT;
  
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  GET DIAGNOSTICS v_deleted_positions = ROW_COUNT;
  
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;
  GET DIAGNOSTICS v_deleted_history = ROW_COUNT;

  -- STEP 2: Get all investors with activity or prior balance (materialized for performance)
  CREATE TEMP TABLE tmp_active_investors ON COMMIT DROP AS
  SELECT DISTINCT investor_code FROM (
    SELECT investor_code FROM trade_file WHERE trade_date = p_trade_date
    UNION
    SELECT investor_code FROM cash_ledger_txn WHERE txn_date = p_trade_date
    UNION
    SELECT investor_code FROM eod_investor_balance WHERE trade_date = v_prev_date
    UNION
    SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
  ) active;

  CREATE INDEX ON tmp_active_investors(investor_code);

  -- STEP 3: Get investor metadata (RM info, department) - optimized with DISTINCT ON
  CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
  SELECT DISTINCT ON (i.investor_code)
    i.investor_code,
    i.investor_name,
    i.brokerage_commission,
    i.interest_rate,
    i.account_type,
    e.employee_id AS rm_id,
    e.name AS rm_name,
    e.email AS rm_email,
    e.department
  FROM tmp_active_investors ai
  JOIN investors i ON ai.investor_code = i.investor_code
  LEFT JOIN employees e ON LOWER(e.email) = LOWER(i.rm_id) OR e.employee_id = i.rm_id
  ORDER BY i.investor_code, e.employee_id NULLS LAST;

  CREATE INDEX ON tmp_investor_meta(investor_code);

  -- STEP 4: Get opening balances with priority chain
  CREATE TEMP TABLE tmp_opening_balances ON COMMIT DROP AS
  SELECT 
    ai.investor_code,
    COALESCE(
      ob.closing_ledger_balance,
      ls.closing_balance,
      inv.ledger_balance,
      0
    ) AS opening_balance,
    COALESCE(ls.cumulative_interest, 0) AS cumulative_interest
  FROM tmp_active_investors ai
  LEFT JOIN eod_investor_balance ob ON ai.investor_code = ob.investor_code AND ob.trade_date = v_prev_date
  LEFT JOIN eod_ledger_snapshots ls ON ai.investor_code = ls.investor_code AND ls.eod_date = v_prev_date
  LEFT JOIN investors inv ON ai.investor_code = inv.investor_code;

  CREATE INDEX ON tmp_opening_balances(investor_code);

  -- STEP 5: Aggregate trades (trade value = qty * price)
  CREATE TEMP TABLE tmp_trades ON COMMIT DROP AS
  SELECT 
    tf.investor_code,
    SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) AS gross_sell,
    SUM(COALESCE(tf.commission, 0)) AS total_commission,
    COUNT(*) AS trade_count
  FROM trade_file tf
  WHERE tf.trade_date = p_trade_date
  GROUP BY tf.investor_code;

  CREATE INDEX ON tmp_trades(investor_code);

  -- STEP 6: Aggregate deposits/withdrawals
  CREATE TEMP TABLE tmp_cashflow ON COMMIT DROP AS
  SELECT 
    c.investor_code,
    SUM(CASE WHEN UPPER(c.type) = 'DEPOSIT' THEN c.amount ELSE 0 END) AS total_deposits,
    SUM(CASE WHEN UPPER(c.type) IN ('WITHDRAW', 'WITHDRAWAL') THEN c.amount ELSE 0 END) AS total_withdrawals,
    COUNT(CASE WHEN UPPER(c.type) = 'DEPOSIT' THEN 1 END) AS deposit_count,
    COUNT(CASE WHEN UPPER(c.type) IN ('WITHDRAW', 'WITHDRAWAL') THEN 1 END) AS withdrawal_count
  FROM cash_ledger_txn c
  WHERE c.txn_date = p_trade_date
  GROUP BY c.investor_code;

  CREATE INDEX ON tmp_cashflow(investor_code);

  -- STEP 7: Build snapshots table
  CREATE TEMP TABLE tmp_snapshots ON COMMIT DROP AS
  SELECT 
    ai.investor_code,
    im.investor_name,
    im.rm_id,
    im.rm_name,
    im.rm_email,
    im.department,
    im.account_type,
    COALESCE(
      CASE 
        WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
        WHEN im.brokerage_commission IS NOT NULL THEN im.brokerage_commission
        ELSE 0.004
      END, 0.004
    ) AS brokerage_rate,
    COALESCE(im.interest_rate, 12) AS interest_rate,
    ob.opening_balance,
    COALESCE(t.gross_buy, 0) AS gross_buy,
    COALESCE(t.gross_sell, 0) AS gross_sell,
    COALESCE(t.total_commission, 0) AS total_commission,
    COALESCE(cf.total_deposits, 0) AS total_deposits,
    COALESCE(cf.total_withdrawals, 0) AS total_withdrawals,
    -- Calculate closing balance
    ob.opening_balance 
      - COALESCE(t.gross_buy, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.total_commission, 0)
      + COALESCE(cf.total_deposits, 0) 
      - COALESCE(cf.total_withdrawals, 0) AS closing_balance,
    -- Calculate daily interest for negative balances
    CASE 
      WHEN (ob.opening_balance - COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0) - COALESCE(t.total_commission, 0) + COALESCE(cf.total_deposits, 0) - COALESCE(cf.total_withdrawals, 0)) < 0 
      THEN ABS(ob.opening_balance - COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0) - COALESCE(t.total_commission, 0) + COALESCE(cf.total_deposits, 0) - COALESCE(cf.total_withdrawals, 0)) * COALESCE(im.interest_rate, 12) / 100 / 365
      ELSE 0
    END AS daily_interest,
    -- Calculate cumulative interest
    ob.cumulative_interest + 
    CASE 
      WHEN (ob.opening_balance - COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0) - COALESCE(t.total_commission, 0) + COALESCE(cf.total_deposits, 0) - COALESCE(cf.total_withdrawals, 0)) < 0 
      THEN ABS(ob.opening_balance - COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0) - COALESCE(t.total_commission, 0) + COALESCE(cf.total_deposits, 0) - COALESCE(cf.total_withdrawals, 0)) * COALESCE(im.interest_rate, 12) / 100 / 365
      ELSE 0
    END AS cumulative_interest,
    0::NUMERIC AS total_market_value,
    0::NUMERIC AS equity
  FROM tmp_active_investors ai
  LEFT JOIN tmp_investor_meta im ON ai.investor_code = im.investor_code
  LEFT JOIN tmp_opening_balances ob ON ai.investor_code = ob.investor_code
  LEFT JOIN tmp_trades t ON ai.investor_code = t.investor_code
  LEFT JOIN tmp_cashflow cf ON ai.investor_code = cf.investor_code;

  CREATE INDEX ON tmp_snapshots(investor_code);

  -- STEP 8: Get instrument prices for the date
  CREATE TEMP TABLE tmp_prices ON COMMIT DROP AS
  SELECT instrument, eod_price
  FROM instrument_prices_eod
  WHERE trade_date = p_trade_date;

  CREATE INDEX ON tmp_prices(instrument);

  -- STEP 9: Calculate positions and market values
  CREATE TEMP TABLE tmp_positions ON COMMIT DROP AS
  SELECT 
    h.investor_code,
    h.trading_code AS instrument,
    h.total_stock,
    h.saleable,
    h.avg_cost,
    h.total_cost,
    COALESCE(h.total_stock * p.eod_price, h.market_value, 0) AS total_market_value
  FROM holdings h
  JOIN tmp_active_investors ai ON h.investor_code = ai.investor_code
  LEFT JOIN tmp_prices p ON h.trading_code = p.instrument
  WHERE h.total_stock > 0;

  CREATE INDEX ON tmp_positions(investor_code);

  -- STEP 10: Aggregate market values per investor
  CREATE TEMP TABLE tmp_market_values ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(total_market_value) AS total_mv
  FROM tmp_positions
  GROUP BY investor_code;

  CREATE INDEX ON tmp_market_values(investor_code);

  -- STEP 11: Update snapshots with market value and equity
  UPDATE tmp_snapshots s
  SET 
    total_market_value = COALESCE(mv.total_mv, 0),
    equity = COALESCE(mv.total_mv, 0) - ABS(LEAST(s.closing_balance, 0)) - s.cumulative_interest
  FROM tmp_market_values mv
  WHERE s.investor_code = mv.investor_code;

  -- Update equity for those without market values
  UPDATE tmp_snapshots
  SET equity = total_market_value - ABS(LEAST(closing_balance, 0)) - cumulative_interest
  WHERE investor_code IS NOT NULL AND total_market_value = 0;

  -- STEP 12: Insert snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, rm_id, rm_name, rm_email, department,
    account_type, brokerage_rate, interest_rate, opening_balance, gross_buy, gross_sell,
    total_commission, total_deposits, total_withdrawals, closing_balance,
    accrued_interest, cumulative_interest, total_mv, ledger_balance, created_by
  )
  SELECT 
    p_trade_date, investor_code, investor_name, rm_id, rm_name, rm_email, department,
    account_type, brokerage_rate, interest_rate, opening_balance, gross_buy, gross_sell,
    total_commission, total_deposits, total_withdrawals, closing_balance,
    daily_interest, cumulative_interest, total_market_value, closing_balance, auth.uid()
  FROM tmp_snapshots;

  GET DIAGNOSTICS v_snapshot_count = ROW_COUNT;

  -- STEP 13: Insert instrument positions
  INSERT INTO eod_instrument_position (
    trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value
  )
  SELECT 
    p_trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value
  FROM tmp_positions;

  GET DIAGNOSTICS v_position_count = ROW_COUNT;

  -- STEP 14: Calculate summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(total_market_value), 0),
    COALESCE(SUM(daily_interest), 0),
    COALESCE(SUM(cumulative_interest), 0),
    COALESCE(SUM(equity), 0),
    COUNT(*) FILTER (WHERE equity < 0),
    COUNT(*) FILTER (WHERE rm_id IS NOT NULL),
    COUNT(*) FILTER (WHERE department IS NOT NULL),
    COUNT(*) FILTER (WHERE closing_balance < 0)
  INTO 
    v_investor_count, v_gross_buy, v_gross_sell, v_total_commission,
    v_total_deposits, v_total_withdrawals, v_total_market_value,
    v_daily_interest_total, v_cumulative_interest_total, v_total_equity,
    v_negative_equity_count, v_with_rm_assigned, v_with_department, v_margin_accounts
  FROM tmp_snapshots;

  SELECT COALESCE(SUM(trade_count), 0) INTO v_trade_count FROM tmp_trades;
  SELECT COALESCE(SUM(deposit_count), 0), COALESCE(SUM(withdrawal_count), 0) 
  INTO v_deposit_count, v_withdrawal_count FROM tmp_cashflow;
  SELECT COUNT(*) INTO v_instruments_priced FROM tmp_prices;

  v_margin_exposure := ABS(COALESCE((SELECT SUM(closing_balance) FROM tmp_snapshots WHERE closing_balance < 0), 0));

  -- STEP 15: Record run history
  INSERT INTO eod_run_history (
    run_date, status, clients_captured, total_ledger_balance, 
    trade_files_count, gross_buy, gross_sell, total_commission,
    deposit_records_count, total_deposits, total_withdrawals,
    run_by, run_by_email
  ) VALUES (
    p_trade_date, 'completed', v_snapshot_count, 
    (SELECT COALESCE(SUM(closing_balance), 0) FROM tmp_snapshots),
    v_trade_count, v_gross_buy, v_gross_sell, v_total_commission,
    v_deposit_count + v_withdrawal_count, v_total_deposits, v_total_withdrawals,
    auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid())
  );

  -- STEP 16: Cleanup staging data for this date
  DELETE FROM trade_file WHERE trade_date = p_trade_date;
  DELETE FROM cash_ledger_txn WHERE txn_date = p_trade_date;

  RETURN jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_investor_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'deposit_count', v_deposit_count,
    'withdrawal_count', v_withdrawal_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'instruments_priced', v_instruments_priced,
    'positions_captured', v_position_count,
    'total_market_value', v_total_market_value,
    'snapshots_created', v_snapshot_count,
    'margin_accounts', v_margin_accounts,
    'margin_exposure', v_margin_exposure,
    'daily_interest_total', v_daily_interest_total,
    'cumulative_interest_total', v_cumulative_interest_total,
    'total_equity', v_total_equity,
    'negative_equity_count', v_negative_equity_count,
    'with_rm_assigned', v_with_rm_assigned,
    'with_department', v_with_department
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;