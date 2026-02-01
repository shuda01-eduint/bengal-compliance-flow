CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
 SET lock_timeout TO '60s'
AS $function$
DECLARE
  v_trade_count integer := 0;
  v_investor_count integer := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_deposit_count integer := 0;
  v_withdrawal_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_instruments_priced integer := 0;
  v_positions_captured integer := 0;
  v_total_market_value numeric := 0;
  v_snapshots_created integer := 0;
  v_margin_accounts integer := 0;
  v_margin_exposure numeric := 0;
  v_daily_interest_total numeric := 0;
  v_cumulative_interest_total numeric := 0;
  v_total_equity numeric := 0;
  v_negative_equity_count integer := 0;
  v_with_rm_assigned integer := 0;
  v_with_department integer := 0;
  v_result jsonb;
  v_prev_date date;
  v_lock_acquired boolean;
BEGIN
  -- Acquire advisory lock to prevent concurrent runs for same date
  SELECT pg_try_advisory_xact_lock(hashtext('eod_' || p_trade_date::text)) INTO v_lock_acquired;
  
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Another EOD process is running for this date',
      'error_detail', 'CONCURRENT_RUN'
    );
  END IF;

  -- Find previous trading day for opening balances
  SELECT MAX(eod_date) INTO v_prev_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_trade_date;

  -- If no previous date, use baseline from balances_raw
  IF v_prev_date IS NULL THEN
    v_prev_date := '2025-01-12'::date;
  END IF;

  -- Delete existing EOD data for this date to allow re-processing
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;

  -- ============================================================
  -- STEP 1: Create investor metadata with RM/department info
  -- ============================================================
  CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
  SELECT DISTINCT ON (i.investor_code)
    i.investor_code,
    i.investor_name,
    i.brokerage_commission,
    i.interest_rate AS investor_interest_rate,
    i.account_type,
    e.employee_id AS rm_id,
    e.name AS rm_name,
    e.email AS rm_email,
    e.department
  FROM investors i
  LEFT JOIN employees e 
    ON LOWER(i.rm_id) = LOWER(e.employee_id)
    OR LOWER(i.rm_name) = LOWER(e.name)
  ORDER BY i.investor_code, 
    CASE WHEN LOWER(i.rm_id) = LOWER(e.employee_id) THEN 0 ELSE 1 END;

  -- ============================================================
  -- STEP 2: Get opening balances from previous day or baseline
  -- ============================================================
  CREATE TEMP TABLE tmp_opening_balances ON COMMIT DROP AS
  SELECT 
    investor_code,
    closing_balance AS opening_balance,
    cumulative_interest
  FROM eod_ledger_snapshots
  WHERE eod_date = v_prev_date;

  IF NOT EXISTS (SELECT 1 FROM tmp_opening_balances LIMIT 1) THEN
    INSERT INTO tmp_opening_balances (investor_code, opening_balance, cumulative_interest)
    SELECT DISTINCT ON (investor_code)
      investor_code,
      COALESCE(ledger_balance, 0),
      0
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    ORDER BY investor_code, created_at DESC;
  END IF;

  -- ============================================================
  -- STEP 3: Aggregate trades for the day with commission calculation
  -- ============================================================
  CREATE TEMP TABLE tmp_trade_agg ON COMMIT DROP AS
  SELECT
    tf.investor_code,
    SUM(CASE WHEN UPPER(tf.side) IN ('BUY', 'B') THEN tf.qty * tf.price ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN UPPER(tf.side) IN ('SELL', 'S') THEN tf.qty * tf.price ELSE 0 END) AS gross_sell,
    SUM(
      CASE 
        WHEN COALESCE(tf.commission, 0) > 0 THEN tf.commission
        ELSE tf.qty * tf.price * COALESCE(
          CASE 
            WHEN im.brokerage_commission IS NULL THEN 0.004
            WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
            ELSE im.brokerage_commission
          END,
          0.004
        )
      END
    ) AS total_commission,
    COUNT(*) AS trade_count
  FROM trade_file tf
  LEFT JOIN tmp_investor_meta im ON tf.investor_code = im.investor_code
  WHERE tf.trade_date = p_trade_date
  GROUP BY tf.investor_code;

  SELECT COUNT(*), COALESCE(SUM(trade_count), 0), 
         COALESCE(SUM(gross_buy), 0), COALESCE(SUM(gross_sell), 0),
         COALESCE(SUM(total_commission), 0)
  INTO v_investor_count, v_trade_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM tmp_trade_agg;

  -- ============================================================
  -- STEP 4: Aggregate deposits/withdrawals for the day
  -- ============================================================
  CREATE TEMP TABLE tmp_cash_flow ON COMMIT DROP AS
  SELECT
    investor_code,
    SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END) AS deposits,
    SUM(CASE WHEN UPPER(type) IN ('WITHDRAW', 'WITHDRAWAL') THEN ABS(amount) ELSE 0 END) AS withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  SELECT 
    COUNT(CASE WHEN deposits > 0 THEN 1 END),
    COUNT(CASE WHEN withdrawals > 0 THEN 1 END),
    COALESCE(SUM(deposits), 0),
    COALESCE(SUM(withdrawals), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM tmp_cash_flow;

  -- ============================================================
  -- STEP 5: Get instrument prices for market value calculation
  -- ============================================================
  CREATE TEMP TABLE tmp_prices ON COMMIT DROP AS
  SELECT instrument, eod_price
  FROM instrument_prices_eod
  WHERE trade_date = p_trade_date;

  SELECT COUNT(*) INTO v_instruments_priced FROM tmp_prices;

  -- ============================================================
  -- STEP 6: Calculate positions from baseline + trades
  -- ============================================================
  CREATE TEMP TABLE tmp_positions ON COMMIT DROP AS
  WITH baseline_positions AS (
    SELECT investor_code, instrument, total_stock, saleable, avg_cost, total_cost
    FROM eod_instrument_position
    WHERE trade_date = v_prev_date
    UNION ALL
    SELECT investor_code, instrument, total_stock, saleable, avg_cost, total_cost
    FROM balances_raw
    WHERE as_of_date = v_prev_date
      AND NOT EXISTS (SELECT 1 FROM eod_instrument_position WHERE trade_date = v_prev_date LIMIT 1)
  ),
  trade_position_changes AS (
    SELECT
      investor_code,
      instrument,
      SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN qty ELSE -qty END) AS qty_change,
      SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN qty * price ELSE 0 END) AS buy_cost
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code, instrument
  )
  SELECT
    COALESCE(bp.investor_code, tc.investor_code) AS investor_code,
    COALESCE(bp.instrument, tc.instrument) AS instrument,
    COALESCE(bp.total_stock, 0) + COALESCE(tc.qty_change, 0) AS total_stock,
    COALESCE(bp.saleable, 0) + COALESCE(tc.qty_change, 0) AS saleable,
    CASE 
      WHEN COALESCE(bp.total_stock, 0) + COALESCE(tc.qty_change, 0) > 0 THEN
        (COALESCE(bp.total_cost, 0) + COALESCE(tc.buy_cost, 0)) / 
        NULLIF(COALESCE(bp.total_stock, 0) + COALESCE(tc.qty_change, 0), 0)
      ELSE 0
    END AS avg_cost,
    COALESCE(bp.total_cost, 0) + COALESCE(tc.buy_cost, 0) AS total_cost
  FROM baseline_positions bp
  FULL OUTER JOIN trade_position_changes tc
    ON bp.investor_code = tc.investor_code AND bp.instrument = tc.instrument
  WHERE COALESCE(bp.total_stock, 0) + COALESCE(tc.qty_change, 0) > 0;

  INSERT INTO eod_instrument_position (trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value)
  SELECT 
    p_trade_date,
    tp.investor_code,
    tp.instrument,
    tp.total_stock,
    tp.saleable,
    tp.avg_cost,
    tp.total_cost,
    tp.total_stock * COALESCE(pr.eod_price, tp.avg_cost)
  FROM tmp_positions tp
  LEFT JOIN tmp_prices pr ON tp.instrument = pr.instrument;

  SELECT COUNT(*) INTO v_positions_captured FROM tmp_positions;

  -- ============================================================
  -- STEP 7: Calculate portfolio market values
  -- ============================================================
  CREATE TEMP TABLE tmp_portfolio_mv ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(total_stock * COALESCE(pr.eod_price, tp.avg_cost)) AS total_market_value
  FROM tmp_positions tp
  LEFT JOIN tmp_prices pr ON tp.instrument = pr.instrument
  GROUP BY investor_code;

  SELECT COALESCE(SUM(total_market_value), 0) INTO v_total_market_value FROM tmp_portfolio_mv;

  -- ============================================================
  -- STEP 8: Build base investor records
  -- ============================================================
  CREATE TEMP TABLE tmp_base_investors ON COMMIT DROP AS
  SELECT
    im.investor_code,
    im.investor_name,
    im.account_type,
    im.rm_id,
    im.rm_name,
    im.rm_email,
    im.department,
    CASE 
      WHEN im.brokerage_commission IS NULL THEN 0.004
      WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
      ELSE im.brokerage_commission
    END AS brokerage_rate,
    im.investor_interest_rate,
    COALESCE(ob.opening_balance, 0) AS opening_balance,
    COALESCE(ob.cumulative_interest, 0) AS prev_cumulative_interest,
    COALESCE(ta.gross_buy, 0) AS gross_buy,
    COALESCE(ta.gross_sell, 0) AS gross_sell,
    COALESCE(ta.total_commission, 0) AS total_commission,
    COALESCE(cf.deposits, 0) AS total_deposits,
    COALESCE(cf.withdrawals, 0) AS total_withdrawals,
    COALESCE(pmv.total_market_value, 0) AS total_mv
  FROM tmp_investor_meta im
  LEFT JOIN tmp_opening_balances ob ON im.investor_code = ob.investor_code
  LEFT JOIN tmp_trade_agg ta ON im.investor_code = ta.investor_code
  LEFT JOIN tmp_cash_flow cf ON im.investor_code = cf.investor_code
  LEFT JOIN tmp_portfolio_mv pmv ON im.investor_code = pmv.investor_code;

  -- ============================================================
  -- STEP 9: Calculate closing balance and interest
  -- ============================================================
  CREATE TEMP TABLE tmp_with_calcs ON COMMIT DROP AS
  SELECT
    bi.*,
    bi.opening_balance + bi.gross_sell - bi.gross_buy - bi.total_commission 
      + bi.total_deposits - bi.total_withdrawals AS closing_balance
  FROM tmp_base_investors bi;

  CREATE TEMP TABLE tmp_with_interest ON COMMIT DROP AS
  SELECT
    wc.*,
    CASE 
      WHEN wc.closing_balance < 0 THEN 
        ABS(wc.closing_balance) * COALESCE(wc.investor_interest_rate, 0.15) / 365
      ELSE 0
    END AS daily_interest,
    wc.prev_cumulative_interest + 
    CASE 
      WHEN wc.closing_balance < 0 THEN 
        ABS(wc.closing_balance) * COALESCE(wc.investor_interest_rate, 0.15) / 365
      ELSE 0
    END AS cumulative_interest,
    wc.total_mv - ABS(LEAST(wc.closing_balance, 0)) - 
    (wc.prev_cumulative_interest + 
      CASE 
        WHEN wc.closing_balance < 0 THEN 
          ABS(wc.closing_balance) * COALESCE(wc.investor_interest_rate, 0.15) / 365
        ELSE 0
      END) AS equity
  FROM tmp_with_calcs wc;

  -- ============================================================
  -- STEP 10: Insert final snapshots
  -- ============================================================
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, account_type,
    rm_id, rm_name, rm_email, department,
    brokerage_rate, interest_rate,
    opening_balance, closing_balance, ledger_balance,
    gross_buy, gross_sell, total_commission,
    total_deposits, total_withdrawals,
    total_mv, accrued_interest, cumulative_interest
  )
  SELECT DISTINCT ON (wi.investor_code)
    p_trade_date, wi.investor_code, wi.investor_name, wi.account_type,
    wi.rm_id, wi.rm_name, wi.rm_email, wi.department,
    wi.brokerage_rate, wi.investor_interest_rate,
    wi.opening_balance, wi.closing_balance, wi.closing_balance,
    wi.gross_buy, wi.gross_sell, wi.total_commission,
    wi.total_deposits, wi.total_withdrawals,
    wi.total_mv, wi.daily_interest, wi.cumulative_interest
  FROM tmp_with_interest wi
  ORDER BY wi.investor_code;

  SELECT 
    COUNT(*),
    COUNT(CASE WHEN closing_balance < 0 THEN 1 END),
    COALESCE(SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END), 0),
    COALESCE(SUM(daily_interest), 0),
    COALESCE(SUM(cumulative_interest), 0),
    COALESCE(SUM(equity), 0),
    COUNT(CASE WHEN equity < 0 THEN 1 END),
    COUNT(CASE WHEN rm_id IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN department IS NOT NULL THEN 1 END)
  INTO 
    v_snapshots_created, v_margin_accounts, v_margin_exposure,
    v_daily_interest_total, v_cumulative_interest_total, v_total_equity,
    v_negative_equity_count, v_with_rm_assigned, v_with_department
  FROM tmp_with_interest;

  -- ============================================================
  -- STEP 11: Insert run history with correct totals
  -- ============================================================
  INSERT INTO eod_run_history (
    run_date, clients_captured, total_ledger_balance,
    trade_files_count, deposit_records_count,
    gross_buy, gross_sell, total_commission,
    total_deposits, total_withdrawals,
    status, notes
  ) VALUES (
    p_trade_date, v_snapshots_created,
    (SELECT COALESCE(SUM(closing_balance), 0) FROM tmp_with_interest),
    v_trade_count, v_deposit_count + v_withdrawal_count,
    v_gross_buy, v_gross_sell, v_total_commission,
    v_total_deposits, v_total_withdrawals,
    'completed', 'Processed via process_staged_trades'
  );

  v_result := jsonb_build_object(
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
    'positions_captured', v_positions_captured,
    'total_market_value', v_total_market_value,
    'snapshots_created', v_snapshots_created,
    'margin_accounts', v_margin_accounts,
    'margin_exposure', v_margin_exposure,
    'daily_interest_total', v_daily_interest_total,
    'cumulative_interest_total', v_cumulative_interest_total,
    'total_equity', v_total_equity,
    'negative_equity_count', v_negative_equity_count,
    'with_rm_assigned', v_with_rm_assigned,
    'with_department', v_with_department
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;