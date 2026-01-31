-- Fix process_staged_trades to properly combine baseline positions with trade activity
-- The current version only captures trade deltas, not actual ending positions

CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '300s'
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_trade_count bigint := 0;
  v_investor_count bigint := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_deposit_count bigint := 0;
  v_withdrawal_count bigint := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_instruments_priced bigint := 0;
  v_positions_captured bigint := 0;
  v_total_market_value numeric := 0;
  v_snapshots_created bigint := 0;
  v_margin_accounts bigint := 0;
  v_margin_exposure numeric := 0;
  v_daily_interest_total numeric := 0;
  v_cumulative_interest_total numeric := 0;
  v_total_equity numeric := 0;
  v_negative_equity_count bigint := 0;
  v_with_rm_assigned bigint := 0;
  v_with_department bigint := 0;
  v_prev_date date;
BEGIN
  -- Find previous business day with data
  SELECT MAX(as_of_date) INTO v_prev_date
  FROM balances_raw
  WHERE as_of_date < p_trade_date;

  -- Delete existing EOD data for this date to prevent duplicates
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;

  -- Create temp table for position market values (needed for both inserts)
  CREATE TEMP TABLE IF NOT EXISTS tmp_position_mv (
    investor_code text,
    instrument text,
    total_stock numeric,
    saleable numeric,
    avg_cost numeric,
    total_cost numeric,
    market_value numeric
  ) ON COMMIT DROP;
  
  TRUNCATE tmp_position_mv;

  -- Populate position market values by combining baseline positions with trade activity
  -- FIX: Now properly merges baseline from balances_raw with trade deltas
  INSERT INTO tmp_position_mv
  WITH baseline_positions AS (
    -- Get previous day's positions from balances_raw
    SELECT
      investor_code,
      instrument,
      COALESCE(total_stock, 0) as baseline_qty,
      COALESCE(saleable, 0) as baseline_saleable,
      COALESCE(avg_cost, 0) as baseline_avg_cost,
      COALESCE(total_cost, 0) as baseline_cost,
      COALESCE(total_mv, 0) as baseline_mv
    FROM balances_raw
    WHERE as_of_date = v_prev_date
      AND instrument IS NOT NULL
      AND instrument != ''
  ),
  trade_deltas AS (
    -- Get net trade activity for today
    SELECT
      tf.investor_code,
      tf.instrument,
      SUM(CASE WHEN tf.side = 'BUY' THEN tf.qty ELSE 0 END) as buy_qty,
      SUM(CASE WHEN tf.side = 'SELL' THEN tf.qty ELSE 0 END) as sell_qty,
      SUM(CASE WHEN tf.side = 'BUY' THEN tf.qty ELSE -tf.qty END) as net_qty,
      SUM(CASE WHEN tf.side = 'BUY' THEN tf.qty * tf.price ELSE 0 END) as buy_cost
    FROM trade_file tf
    WHERE tf.trade_date = p_trade_date
    GROUP BY tf.investor_code, tf.instrument
  ),
  prices AS (
    SELECT instrument, eod_price
    FROM instrument_prices_eod
    WHERE trade_date = p_trade_date
  ),
  combined_positions AS (
    -- Full outer join to get all positions (baseline only, trades only, or both)
    SELECT
      COALESCE(bp.investor_code, td.investor_code) as investor_code,
      COALESCE(bp.instrument, td.instrument) as instrument,
      COALESCE(bp.baseline_qty, 0) as baseline_qty,
      COALESCE(bp.baseline_saleable, 0) as baseline_saleable,
      COALESCE(bp.baseline_avg_cost, 0) as baseline_avg_cost,
      COALESCE(bp.baseline_cost, 0) as baseline_cost,
      COALESCE(td.buy_qty, 0) as buy_qty,
      COALESCE(td.sell_qty, 0) as sell_qty,
      COALESCE(td.net_qty, 0) as net_qty,
      COALESCE(td.buy_cost, 0) as buy_cost
    FROM baseline_positions bp
    FULL OUTER JOIN trade_deltas td 
      ON bp.investor_code = td.investor_code 
      AND bp.instrument = td.instrument
  )
  SELECT
    cp.investor_code,
    cp.instrument,
    -- Ending stock = baseline + buys - sells
    cp.baseline_qty + cp.buy_qty - cp.sell_qty as total_stock,
    -- Saleable = baseline_saleable - sells (buys not immediately saleable)
    GREATEST(0, cp.baseline_saleable - cp.sell_qty) as saleable,
    -- Avg cost: weighted average of baseline and new buys
    CASE 
      WHEN (cp.baseline_qty + cp.buy_qty - cp.sell_qty) > 0 AND (cp.baseline_qty + cp.buy_qty) > 0 
      THEN (cp.baseline_cost + cp.buy_cost) / NULLIF(cp.baseline_qty + cp.buy_qty, 0)
      ELSE cp.baseline_avg_cost 
    END as avg_cost,
    -- Total cost: baseline cost + buy cost - (sold qty * avg cost)
    GREATEST(0, cp.baseline_cost + cp.buy_cost - (cp.sell_qty * 
      CASE 
        WHEN (cp.baseline_qty + cp.buy_qty) > 0 
        THEN (cp.baseline_cost + cp.buy_cost) / NULLIF(cp.baseline_qty + cp.buy_qty, 0)
        ELSE cp.baseline_avg_cost 
      END
    )) as total_cost,
    -- Market value = ending qty * EOD price
    COALESCE(pr.eod_price, 0) * (cp.baseline_qty + cp.buy_qty - cp.sell_qty) as market_value
  FROM combined_positions cp
  LEFT JOIN prices pr ON cp.instrument = pr.instrument
  WHERE (cp.baseline_qty + cp.buy_qty - cp.sell_qty) <> 0;

  -- Insert ledger snapshots using trade aggregates
  WITH trade_agg AS (
    SELECT
      tf.investor_code,
      COUNT(*) as trade_count,
      SUM(CASE WHEN tf.side = 'BUY' THEN tf.qty * tf.price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN tf.side = 'SELL' THEN tf.qty * tf.price ELSE 0 END) as gross_sell,
      -- Commission calculation with rate normalization
      SUM(
        tf.qty * tf.price * 
        CASE 
          WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
          WHEN i.brokerage_commission < 0.1 AND i.brokerage_commission > 0 THEN i.brokerage_commission
          ELSE 0.004
        END
      ) as total_commission
    FROM trade_file tf
    LEFT JOIN investors i ON tf.investor_code = i.investor_code
    WHERE tf.trade_date = p_trade_date
    GROUP BY tf.investor_code
  ),
  cash_agg AS (
    SELECT
      investor_code,
      SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals,
      COUNT(CASE WHEN type = 'DEPOSIT' THEN 1 END) as deposit_count,
      COUNT(CASE WHEN type = 'WITHDRAWAL' THEN 1 END) as withdrawal_count
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  ),
  prev_bal AS (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      ledger_balance as opening_balance,
      total_mv as opening_mv,
      rm_id,
      rm_name,
      rm_email
    FROM balances_raw
    WHERE as_of_date = v_prev_date
    ORDER BY investor_code, as_of_date DESC
  ),
  emp_info AS (
    SELECT 
      employee_id,
      name,
      email,
      department
    FROM employees
    WHERE status = 'Active'
  ),
  investor_mv AS (
    SELECT
      investor_code,
      SUM(market_value) as total_mv,
      COUNT(*) as position_count
    FROM tmp_position_mv
    GROUP BY investor_code
  ),
  investor_snapshot AS (
    SELECT
      inv.investor_code,
      inv.investor_name,
      COALESCE(pb.opening_balance, inv.ledger_balance, 0) as opening_balance,
      COALESCE(ta.gross_buy, 0) as gross_buy,
      COALESCE(ta.gross_sell, 0) as gross_sell,
      COALESCE(ta.total_commission, 0) as total_commission,
      COALESCE(ca.deposits, 0) as total_deposits,
      COALESCE(ca.withdrawals, 0) as total_withdrawals,
      COALESCE(pb.opening_balance, inv.ledger_balance, 0) 
        + COALESCE(ta.gross_sell, 0) 
        - COALESCE(ta.gross_buy, 0) 
        - COALESCE(ta.total_commission, 0)
        + COALESCE(ca.deposits, 0) 
        - COALESCE(ca.withdrawals, 0) as closing_balance,
      inv.brokerage_commission as brokerage_rate,
      inv.interest_rate,
      COALESCE(ei.employee_id, pb.rm_id, inv.rm_id) as rm_id,
      COALESCE(ei.name, pb.rm_name, inv.rm_name) as rm_name,
      COALESCE(ei.email, pb.rm_email) as rm_email,
      COALESCE(ei.department, inv.department) as department,
      inv.account_type,
      -- Use calculated MV from positions, falling back to previous day's MV for investors without trades
      COALESCE(imv.total_mv, pb.opening_mv, 0) as total_mv
    FROM investors inv
    LEFT JOIN trade_agg ta ON inv.investor_code = ta.investor_code
    LEFT JOIN cash_agg ca ON inv.investor_code = ca.investor_code
    LEFT JOIN prev_bal pb ON inv.investor_code = pb.investor_code
    LEFT JOIN emp_info ei ON inv.rm_id = ei.employee_id
    LEFT JOIN investor_mv imv ON inv.investor_code = imv.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    opening_balance,
    closing_balance,
    ledger_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    total_mv,
    brokerage_rate,
    interest_rate,
    rm_id,
    rm_name,
    rm_email,
    department,
    account_type,
    accrued_interest,
    cumulative_interest
  )
  SELECT
    p_trade_date,
    iss.investor_code,
    iss.investor_name,
    iss.opening_balance,
    iss.closing_balance,
    iss.closing_balance,
    iss.gross_buy,
    iss.gross_sell,
    iss.total_commission,
    iss.total_deposits,
    iss.total_withdrawals,
    iss.total_mv,
    iss.brokerage_rate,
    iss.interest_rate,
    iss.rm_id,
    iss.rm_name,
    iss.rm_email,
    iss.department,
    iss.account_type,
    CASE 
      WHEN iss.closing_balance < 0 THEN 
        ABS(iss.closing_balance) * COALESCE(iss.interest_rate, 12) / 100 / 365
      ELSE 0 
    END,
    0
  FROM investor_snapshot iss;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Insert position snapshots from temp table
  INSERT INTO eod_instrument_position (
    trade_date,
    investor_code,
    instrument,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    total_market_value
  )
  SELECT
    p_trade_date,
    investor_code,
    instrument,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    market_value
  FROM tmp_position_mv;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Get trade count
  SELECT COUNT(*) INTO v_trade_count FROM trade_file WHERE trade_date = p_trade_date;

  -- Recalculate totals from snapshots
  SELECT 
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0)
  INTO v_total_commission, v_gross_buy, v_gross_sell
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Get deposit/withdrawal stats
  SELECT 
    COUNT(CASE WHEN type = 'DEPOSIT' THEN 1 END),
    COUNT(CASE WHEN type = 'WITHDRAWAL' THEN 1 END),
    COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Get unique investor count
  SELECT COUNT(DISTINCT investor_code) INTO v_investor_count
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Get instruments priced
  SELECT COUNT(*) INTO v_instruments_priced
  FROM instrument_prices_eod WHERE trade_date = p_trade_date;

  -- Get total market value
  SELECT COALESCE(SUM(total_mv), 0) INTO v_total_market_value
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Get margin statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(ABS(closing_balance)), 0),
    COALESCE(SUM(accrued_interest), 0)
  INTO v_margin_accounts, v_margin_exposure, v_daily_interest_total
  FROM eod_ledger_snapshots 
  WHERE eod_date = p_trade_date AND closing_balance < 0;

  -- Get equity and negative equity count
  SELECT 
    COALESCE(SUM(total_mv + closing_balance), 0),
    COUNT(CASE WHEN (total_mv + closing_balance) < 0 THEN 1 END)
  INTO v_total_equity, v_negative_equity_count
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;

  -- Get RM assignment stats
  SELECT COUNT(*) INTO v_with_rm_assigned
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date AND rm_id IS NOT NULL;

  SELECT COUNT(*) INTO v_with_department
  FROM eod_ledger_snapshots WHERE eod_date = p_trade_date AND department IS NOT NULL;

  -- Build result
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