-- Update process_staged_trades to prioritize eod_investor_balance for opening balances
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
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
  v_prev_date := p_trade_date - INTERVAL '1 day';

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
  -- STEP 2: Get opening balances with priority chain:
  --   1. eod_investor_balance.closing_ledger_balance (official baseline)
  --   2. eod_ledger_snapshots.closing_balance (previous day snapshot)
  --   3. investors.ledger_balance (master table)
  --   4. 0 (new accounts)
  -- ============================================================
  CREATE TEMP TABLE tmp_opening_balances ON COMMIT DROP AS
  WITH official_baseline AS (
    SELECT investor_code, closing_ledger_balance
    FROM eod_investor_balance
    WHERE trade_date = v_prev_date
  ),
  snapshot_chain AS (
    SELECT investor_code, closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  master_baseline AS (
    SELECT investor_code, COALESCE(ledger_balance, 0) AS ledger_balance
    FROM investors
  )
  SELECT 
    COALESCE(ob.investor_code, sc.investor_code, mb.investor_code) AS investor_code,
    COALESCE(ob.closing_ledger_balance, sc.closing_balance, mb.ledger_balance, 0) AS opening_balance,
    COALESCE(sc.cumulative_interest, 0) AS cumulative_interest
  FROM master_baseline mb
  LEFT JOIN official_baseline ob ON ob.investor_code = mb.investor_code
  LEFT JOIN snapshot_chain sc ON sc.investor_code = mb.investor_code;

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

  -- ============================================================
  -- STEP 4: Aggregate deposits/withdrawals from cash_ledger_txn
  -- ============================================================
  CREATE TEMP TABLE tmp_cash_agg ON COMMIT DROP AS
  SELECT
    investor_code,
    SUM(CASE WHEN UPPER(type) IN ('DEPOSIT', 'D', 'CR') THEN amount ELSE 0 END) AS total_deposits,
    SUM(CASE WHEN UPPER(type) IN ('WITHDRAWAL', 'W', 'DR') THEN amount ELSE 0 END) AS total_withdrawals,
    COUNT(CASE WHEN UPPER(type) IN ('DEPOSIT', 'D', 'CR') THEN 1 END) AS deposit_count,
    COUNT(CASE WHEN UPPER(type) IN ('WITHDRAWAL', 'W', 'DR') THEN 1 END) AS withdrawal_count
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  -- ============================================================
  -- STEP 5: Get positions and market values
  -- ============================================================
  CREATE TEMP TABLE tmp_positions ON COMMIT DROP AS
  WITH position_base AS (
    SELECT DISTINCT ON (investor_code, instrument)
      investor_code,
      instrument,
      total_stock,
      saleable,
      avg_cost,
      total_cost
    FROM eod_instrument_position
    WHERE trade_date = v_prev_date
    ORDER BY investor_code, instrument
  ),
  trade_changes AS (
    SELECT
      investor_code,
      instrument,
      SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN qty ELSE 0 END) AS bought_qty,
      SUM(CASE WHEN UPPER(side) IN ('SELL', 'S') THEN qty ELSE 0 END) AS sold_qty,
      SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN qty * price ELSE 0 END) AS buy_cost
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code, instrument
  ),
  merged_positions AS (
    SELECT 
      COALESCE(pb.investor_code, tc.investor_code) AS investor_code,
      COALESCE(pb.instrument, tc.instrument) AS instrument,
      COALESCE(pb.total_stock, 0) + COALESCE(tc.bought_qty, 0) - COALESCE(tc.sold_qty, 0) AS total_stock,
      GREATEST(0, COALESCE(pb.saleable, 0) - COALESCE(tc.sold_qty, 0)) AS saleable,
      COALESCE(pb.avg_cost, 0) AS avg_cost,
      COALESCE(pb.total_cost, 0) + COALESCE(tc.buy_cost, 0) - 
        (COALESCE(tc.sold_qty, 0) * COALESCE(pb.avg_cost, 0)) AS total_cost
    FROM position_base pb
    FULL OUTER JOIN trade_changes tc 
      ON pb.investor_code = tc.investor_code AND pb.instrument = tc.instrument
    WHERE COALESCE(pb.total_stock, 0) + COALESCE(tc.bought_qty, 0) - COALESCE(tc.sold_qty, 0) > 0
  )
  SELECT 
    mp.investor_code,
    mp.instrument,
    mp.total_stock,
    mp.saleable,
    CASE WHEN mp.total_stock > 0 THEN mp.total_cost / mp.total_stock ELSE 0 END AS avg_cost,
    mp.total_cost,
    COALESCE(ip.eod_price, s.close_price, 0) AS eod_price,
    mp.total_stock * COALESCE(ip.eod_price, s.close_price, 0) AS market_value
  FROM merged_positions mp
  LEFT JOIN instrument_prices_eod ip 
    ON ip.instrument = mp.instrument AND ip.trade_date = p_trade_date
  LEFT JOIN securities s ON s.trading_code = mp.instrument;

  -- Insert positions into eod_instrument_position
  INSERT INTO eod_instrument_position (trade_date, investor_code, instrument, total_stock, saleable, avg_cost, total_cost, total_market_value)
  SELECT 
    p_trade_date,
    investor_code,
    instrument,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    market_value
  FROM tmp_positions;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- ============================================================
  -- STEP 6: Aggregate market values per investor
  -- ============================================================
  CREATE TEMP TABLE tmp_mv_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(market_value) AS total_market_value,
    SUM(total_cost) AS total_portfolio_cost
  FROM tmp_positions
  GROUP BY investor_code;

  -- Count instruments priced
  SELECT COUNT(DISTINCT instrument) INTO v_instruments_priced
  FROM tmp_positions
  WHERE eod_price > 0;

  -- ============================================================
  -- STEP 7: Build final snapshots with closing balances and equity
  -- ============================================================
  CREATE TEMP TABLE tmp_snapshots ON COMMIT DROP AS
  SELECT
    im.investor_code,
    im.investor_name,
    im.rm_id,
    im.rm_name,
    im.rm_email,
    im.department,
    im.account_type,
    CASE 
      WHEN im.brokerage_commission IS NULL THEN 0.004
      WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
      ELSE im.brokerage_commission
    END AS brokerage_rate,
    COALESCE(im.investor_interest_rate, 15) AS interest_rate,
    COALESCE(ob.opening_balance, 0) AS opening_balance,
    COALESCE(ob.cumulative_interest, 0) AS prev_cumulative_interest,
    COALESCE(ta.gross_buy, 0) AS gross_buy,
    COALESCE(ta.gross_sell, 0) AS gross_sell,
    COALESCE(ta.total_commission, 0) AS total_commission,
    COALESCE(ca.total_deposits, 0) AS total_deposits,
    COALESCE(ca.total_withdrawals, 0) AS total_withdrawals,
    COALESCE(mv.total_market_value, 0) AS total_market_value,
    COALESCE(mv.total_portfolio_cost, 0) AS total_portfolio_cost,
    -- Calculate closing balance: opening + deposits - withdrawals + sells - buys - commission
    COALESCE(ob.opening_balance, 0) 
      + COALESCE(ca.total_deposits, 0) 
      - COALESCE(ca.total_withdrawals, 0)
      + COALESCE(ta.gross_sell, 0)
      - COALESCE(ta.gross_buy, 0)
      - COALESCE(ta.total_commission, 0) AS closing_balance
  FROM tmp_investor_meta im
  LEFT JOIN tmp_opening_balances ob ON ob.investor_code = im.investor_code
  LEFT JOIN tmp_trade_agg ta ON ta.investor_code = im.investor_code
  LEFT JOIN tmp_cash_agg ca ON ca.investor_code = im.investor_code
  LEFT JOIN tmp_mv_agg mv ON mv.investor_code = im.investor_code
  WHERE 
    ta.investor_code IS NOT NULL 
    OR ca.investor_code IS NOT NULL 
    OR mv.total_market_value > 0
    OR ob.opening_balance IS NOT NULL;

  -- Add interest calculations for margin accounts
  ALTER TABLE tmp_snapshots 
    ADD COLUMN daily_interest numeric DEFAULT 0,
    ADD COLUMN cumulative_interest numeric DEFAULT 0,
    ADD COLUMN equity numeric DEFAULT 0;

  UPDATE tmp_snapshots
  SET 
    daily_interest = CASE 
      WHEN closing_balance < 0 THEN 
        ABS(closing_balance) * (interest_rate / 100) / 365
      ELSE 0 
    END,
    cumulative_interest = prev_cumulative_interest + CASE 
      WHEN closing_balance < 0 THEN 
        ABS(closing_balance) * (interest_rate / 100) / 365
      ELSE 0 
    END;

  UPDATE tmp_snapshots
  SET equity = total_market_value - ABS(LEAST(closing_balance, 0)) - cumulative_interest;

  -- ============================================================
  -- STEP 8: Insert into eod_ledger_snapshots
  -- ============================================================
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_id,
    rm_name,
    rm_email,
    department,
    account_type,
    brokerage_rate,
    interest_rate,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    total_mv,
    total_cost,
    closing_balance,
    ledger_balance,
    accrued_interest,
    cumulative_interest,
    unrealized_pnl
  )
  SELECT
    p_trade_date,
    investor_code,
    investor_name,
    rm_id,
    rm_name,
    rm_email,
    department,
    account_type,
    brokerage_rate,
    interest_rate,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    total_market_value,
    total_portfolio_cost,
    closing_balance,
    closing_balance,
    daily_interest,
    cumulative_interest,
    total_market_value - total_portfolio_cost
  FROM tmp_snapshots;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- ============================================================
  -- STEP 9: Collect summary statistics
  -- ============================================================
  SELECT 
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(total_market_value), 0),
    COALESCE(SUM(daily_interest), 0),
    COALESCE(SUM(cumulative_interest), 0),
    COALESCE(SUM(equity), 0),
    COUNT(CASE WHEN equity < 0 THEN 1 END),
    COUNT(CASE WHEN closing_balance < 0 THEN 1 END),
    COUNT(CASE WHEN rm_id IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN department IS NOT NULL THEN 1 END)
  INTO 
    v_gross_buy, v_gross_sell, v_total_commission,
    v_total_deposits, v_total_withdrawals, v_total_market_value,
    v_daily_interest_total, v_cumulative_interest_total, v_total_equity,
    v_negative_equity_count, v_margin_accounts,
    v_with_rm_assigned, v_with_department
  FROM tmp_snapshots;

  v_margin_exposure := v_gross_buy;

  SELECT COUNT(*) INTO v_trade_count FROM trade_file WHERE trade_date = p_trade_date;
  SELECT COUNT(*) INTO v_deposit_count FROM cash_ledger_txn WHERE txn_date = p_trade_date AND UPPER(type) IN ('DEPOSIT', 'D', 'CR');
  SELECT COUNT(*) INTO v_withdrawal_count FROM cash_ledger_txn WHERE txn_date = p_trade_date AND UPPER(type) IN ('WITHDRAWAL', 'W', 'DR');

  v_investor_count := v_snapshots_created;

  -- ============================================================
  -- STEP 10: Record run in history
  -- ============================================================
  INSERT INTO eod_run_history (
    run_date,
    clients_captured,
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    status
  )
  VALUES (
    p_trade_date,
    v_snapshots_created,
    (SELECT COALESCE(SUM(closing_balance), 0) FROM tmp_snapshots),
    v_trade_count,
    v_deposit_count + v_withdrawal_count,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'completed'
  );

  -- Build result
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

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;