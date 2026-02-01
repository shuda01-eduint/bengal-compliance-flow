-- Fix run_batch_eod and process_staged_trades: side values are 'BUY'/'SELL' not 'B'/'S'
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_user_id UUID;
  v_user_email TEXT;
  v_existing_run_id UUID;
BEGIN
  -- Get current user info
  v_user_id := auth.uid();
  v_user_email := COALESCE(
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    current_setting('request.jwt.claims', true)::json->>'email'
  );

  -- Check for existing run if skip_existing is true
  IF p_skip_existing THEN
    SELECT id INTO v_existing_run_id
    FROM eod_run_history
    WHERE run_date = p_eod_date
    LIMIT 1;

    IF v_existing_run_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', 'EOD already exists for this date',
        'eod_date', p_eod_date
      );
    END IF;
  END IF;

  -- Delete existing data for this date (if re-running)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Count trade files for this date
  SELECT COUNT(DISTINCT exchange_code)
  INTO v_trade_files_count
  FROM trade_file
  WHERE trade_date = p_eod_date;

  -- Calculate deposit/withdrawal totals using type column (accept both WITHDRAW and WITHDRAWAL)
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL') THEN amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_total_deposits, v_total_withdrawals, v_deposit_records_count
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Insert snapshots for all investors
  WITH base_investors AS MATERIALIZED (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.brokerage_commission,
      i.interest_rate,
      i.account_type,
      i.rm_id,
      i.rm_name,
      i.department,
      e.email as rm_email
    FROM investors i
    LEFT JOIN employees e ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(i.rm_id))
  ),
  prior_eod AS MATERIALIZED (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      closing_balance,
      cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date < p_eod_date
    ORDER BY investor_code, eod_date DESC
  ),
  today_trades AS MATERIALIZED (
    SELECT
      tf.investor_code,
      -- Accept both 'B'/'S' and 'BUY'/'SELL'
      SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) as gross_sell,
      SUM(
        (tf.qty * tf.price) * 
        CASE 
          WHEN bi.brokerage_commission >= 0.1 THEN bi.brokerage_commission / 100
          WHEN bi.brokerage_commission > 0 AND bi.brokerage_commission < 0.1 THEN bi.brokerage_commission
          ELSE 0.004
        END
      ) as commission
    FROM trade_file tf
    JOIN base_investors bi ON tf.investor_code = bi.investor_code
    WHERE tf.trade_date = p_eod_date
    GROUP BY tf.investor_code
  ),
  today_cash AS MATERIALIZED (
    SELECT
      investor_code,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL') THEN amount ELSE 0 END), 0) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_eod_date
    GROUP BY investor_code
  ),
  computed AS (
    SELECT
      bi.investor_code,
      bi.investor_name,
      bi.brokerage_commission as brokerage_rate,
      bi.interest_rate,
      bi.account_type,
      bi.rm_id,
      bi.rm_name,
      bi.rm_email,
      bi.department,
      COALESCE(pe.closing_balance, 0) as opening_balance,
      COALESCE(pe.cumulative_interest, 0) as prior_cumulative_interest,
      COALESCE(tt.gross_buy, 0) as gross_buy,
      COALESCE(tt.gross_sell, 0) as gross_sell,
      COALESCE(tt.commission, 0) as commission,
      COALESCE(tc.deposits, 0) as deposits,
      COALESCE(tc.withdrawals, 0) as withdrawals,
      -- closing = opening + deposits - withdrawals + sells - buys - commission
      COALESCE(pe.closing_balance, 0)
        + COALESCE(tc.deposits, 0)
        - COALESCE(tc.withdrawals, 0)
        + COALESCE(tt.gross_sell, 0)
        - COALESCE(tt.gross_buy, 0)
        - COALESCE(tt.commission, 0) as closing_balance
    FROM base_investors bi
    LEFT JOIN prior_eod pe ON bi.investor_code = pe.investor_code
    LEFT JOIN today_trades tt ON bi.investor_code = tt.investor_code
    LEFT JOIN today_cash tc ON bi.investor_code = tc.investor_code
  ),
  with_interest AS (
    SELECT
      c.*,
      CASE 
        WHEN c.closing_balance < 0 THEN 
          ABS(c.closing_balance) * COALESCE(c.interest_rate, 0.15) / 365
        ELSE 0
      END as daily_interest,
      c.prior_cumulative_interest + 
      CASE 
        WHEN c.closing_balance < 0 THEN 
          ABS(c.closing_balance) * COALESCE(c.interest_rate, 0.15) / 365
        ELSE 0
      END as cumulative_interest
    FROM computed c
  ),
  inserted AS (
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      brokerage_rate,
      interest_rate,
      account_type,
      rm_id,
      rm_name,
      rm_email,
      department,
      opening_balance,
      closing_balance,
      gross_buy,
      gross_sell,
      total_commission,
      total_deposits,
      total_withdrawals,
      accrued_interest,
      cumulative_interest,
      ledger_balance,
      created_by
    )
    SELECT
      p_eod_date,
      wi.investor_code,
      wi.investor_name,
      wi.brokerage_rate,
      wi.interest_rate,
      wi.account_type,
      wi.rm_id,
      wi.rm_name,
      wi.rm_email,
      wi.department,
      wi.opening_balance,
      wi.closing_balance,
      wi.gross_buy,
      wi.gross_sell,
      wi.commission,
      wi.deposits,
      wi.withdrawals,
      wi.daily_interest,
      wi.cumulative_interest,
      wi.closing_balance,
      v_user_id
    FROM with_interest wi
    RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission
  )
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO v_clients_captured, v_total_ledger_balance, v_gross_buy, v_gross_sell, v_total_commission
  FROM inserted;

  -- Record the run in history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
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
  ) VALUES (
    p_eod_date,
    v_user_id,
    v_user_email,
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;

-- Fix process_staged_trades: side values are 'BUY'/'SELL' not 'B'/'S'
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
AS $$
DECLARE
  v_trade_count INTEGER := 0;
  v_investor_count INTEGER := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_deposit_count INTEGER := 0;
  v_withdrawal_count INTEGER := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_instruments_priced INTEGER := 0;
  v_positions_captured INTEGER := 0;
  v_total_market_value NUMERIC := 0;
  v_snapshots_created INTEGER := 0;
  v_margin_accounts INTEGER := 0;
  v_margin_exposure NUMERIC := 0;
  v_daily_interest_total NUMERIC := 0;
  v_cumulative_interest_total NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_negative_equity_count INTEGER := 0;
  v_with_rm_assigned INTEGER := 0;
  v_with_department INTEGER := 0;
BEGIN
  -- Delete existing EOD data for this date first
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;

  -- Create temp tables for better performance
  CREATE TEMP TABLE tmp_base_investors ON COMMIT DROP AS
  SELECT 
    i.investor_code,
    i.investor_name,
    i.brokerage_commission,
    i.interest_rate,
    i.account_type,
    i.rm_id,
    i.rm_name,
    i.department,
    e.email as rm_email
  FROM investors i
  LEFT JOIN employees e ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(i.rm_id));

  CREATE INDEX ON tmp_base_investors(investor_code);

  -- Get prior EOD data (latest before this date)
  CREATE TEMP TABLE tmp_prior_eod ON COMMIT DROP AS
  SELECT DISTINCT ON (investor_code)
    investor_code,
    closing_balance,
    cumulative_interest
  FROM eod_ledger_snapshots
  WHERE eod_date < p_trade_date
  ORDER BY investor_code, eod_date DESC;

  CREATE INDEX ON tmp_prior_eod(investor_code);

  -- Aggregate trades with commission from investor rate (accept both B/S and BUY/SELL)
  CREATE TEMP TABLE tmp_trade_agg ON COMMIT DROP AS
  SELECT
    tf.investor_code,
    SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) as gross_buy,
    SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) as gross_sell,
    SUM(
      (tf.qty * tf.price) * 
      CASE 
        WHEN bi.brokerage_commission >= 0.1 THEN bi.brokerage_commission / 100
        WHEN bi.brokerage_commission > 0 AND bi.brokerage_commission < 0.1 THEN bi.brokerage_commission
        ELSE 0.004
      END
    ) as commission
  FROM trade_file tf
  JOIN tmp_base_investors bi ON tf.investor_code = bi.investor_code
  WHERE tf.trade_date = p_trade_date
  GROUP BY tf.investor_code;

  CREATE INDEX ON tmp_trade_agg(investor_code);

  -- Aggregate cash transactions (accept both WITHDRAW and WITHDRAWAL)
  CREATE TEMP TABLE tmp_cash_agg ON COMMIT DROP AS
  SELECT
    investor_code,
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL') THEN amount ELSE 0 END), 0) as withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX ON tmp_cash_agg(investor_code);

  -- Compute snapshots
  CREATE TEMP TABLE tmp_snapshots ON COMMIT DROP AS
  SELECT
    bi.investor_code,
    bi.investor_name,
    bi.brokerage_commission as brokerage_rate,
    bi.interest_rate,
    bi.account_type,
    bi.rm_id,
    bi.rm_name,
    bi.rm_email,
    bi.department,
    COALESCE(pe.closing_balance, 0) as opening_balance,
    COALESCE(pe.cumulative_interest, 0) as prior_cumulative_interest,
    COALESCE(ta.gross_buy, 0) as gross_buy,
    COALESCE(ta.gross_sell, 0) as gross_sell,
    COALESCE(ta.commission, 0) as commission,
    COALESCE(ca.deposits, 0) as deposits,
    COALESCE(ca.withdrawals, 0) as withdrawals,
    COALESCE(pe.closing_balance, 0)
      + COALESCE(ca.deposits, 0)
      - COALESCE(ca.withdrawals, 0)
      + COALESCE(ta.gross_sell, 0)
      - COALESCE(ta.gross_buy, 0)
      - COALESCE(ta.commission, 0) as closing_balance
  FROM tmp_base_investors bi
  LEFT JOIN tmp_prior_eod pe ON bi.investor_code = pe.investor_code
  LEFT JOIN tmp_trade_agg ta ON bi.investor_code = ta.investor_code
  LEFT JOIN tmp_cash_agg ca ON bi.investor_code = ca.investor_code;

  CREATE INDEX ON tmp_snapshots(investor_code);

  -- Add interest calculations
  CREATE TEMP TABLE tmp_with_interest ON COMMIT DROP AS
  SELECT
    s.*,
    CASE 
      WHEN s.closing_balance < 0 THEN 
        ABS(s.closing_balance) * COALESCE(s.interest_rate, 0.15) / 365
      ELSE 0
    END as daily_interest,
    s.prior_cumulative_interest + 
    CASE 
      WHEN s.closing_balance < 0 THEN 
        ABS(s.closing_balance) * COALESCE(s.interest_rate, 0.15) / 365
      ELSE 0
    END as cumulative_interest
  FROM tmp_snapshots s;

  -- Insert into eod_ledger_snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    brokerage_rate,
    interest_rate,
    account_type,
    rm_id,
    rm_name,
    rm_email,
    department,
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    accrued_interest,
    cumulative_interest,
    ledger_balance,
    created_by
  )
  SELECT
    p_trade_date,
    wi.investor_code,
    wi.investor_name,
    wi.brokerage_rate,
    wi.interest_rate,
    wi.account_type,
    wi.rm_id,
    wi.rm_name,
    wi.rm_email,
    wi.department,
    wi.opening_balance,
    wi.closing_balance,
    wi.gross_buy,
    wi.gross_sell,
    wi.commission,
    wi.deposits,
    wi.withdrawals,
    wi.daily_interest,
    wi.cumulative_interest,
    wi.closing_balance,
    auth.uid()
  FROM tmp_with_interest wi;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Capture positions from balances_raw
  INSERT INTO eod_instrument_position (
    trade_date, investor_code, instrument, total_stock, saleable, 
    avg_cost, total_cost, total_market_value
  )
  SELECT 
    p_trade_date,
    br.investor_code,
    br.instrument,
    COALESCE(br.total_stock, 0),
    COALESCE(br.saleable, 0),
    COALESCE(br.avg_cost, 0),
    COALESCE(br.total_cost, 0),
    COALESCE(br.total_mv, 0)
  FROM balances_raw br
  WHERE br.as_of_date = (SELECT MAX(as_of_date) FROM balances_raw WHERE as_of_date <= p_trade_date)
    AND br.instrument IS NOT NULL
    AND br.total_stock > 0;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Calculate stats
  SELECT COUNT(*), COALESCE(SUM(commission), 0)
  INTO v_trade_count, v_total_commission
  FROM tmp_trade_agg;

  SELECT COUNT(DISTINCT investor_code) INTO v_investor_count FROM tmp_trade_agg;

  SELECT COALESCE(SUM(gross_buy), 0), COALESCE(SUM(gross_sell), 0)
  INTO v_gross_buy, v_gross_sell
  FROM tmp_trade_agg;

  -- Deposit/withdrawal stats (accept both WITHDRAW and WITHDRAWAL)
  SELECT 
    COUNT(*) FILTER (WHERE UPPER(TRIM(type)) = 'DEPOSIT'),
    COUNT(*) FILTER (WHERE UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL')),
    COALESCE(SUM(amount) FILTER (WHERE UPPER(TRIM(type)) = 'DEPOSIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL')), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Calculate market value from positions
  SELECT COALESCE(SUM(total_market_value), 0)
  INTO v_total_market_value
  FROM eod_instrument_position
  WHERE trade_date = p_trade_date;

  -- Calculate margin and interest stats
  SELECT 
    COUNT(*) FILTER (WHERE closing_balance < 0),
    COALESCE(SUM(ABS(closing_balance)) FILTER (WHERE closing_balance < 0), 0),
    COALESCE(SUM(daily_interest), 0),
    COALESCE(SUM(cumulative_interest), 0)
  INTO v_margin_accounts, v_margin_exposure, v_daily_interest_total, v_cumulative_interest_total
  FROM tmp_with_interest;

  -- Calculate equity stats
  SELECT 
    COALESCE(SUM(
      COALESCE((SELECT SUM(eip.total_market_value) 
                FROM eod_instrument_position eip 
                WHERE eip.investor_code = wi.investor_code 
                  AND eip.trade_date = p_trade_date), 0)
      - ABS(LEAST(wi.closing_balance, 0))
      - wi.cumulative_interest
    ), 0),
    COUNT(*) FILTER (WHERE 
      COALESCE((SELECT SUM(eip.total_market_value) 
                FROM eod_instrument_position eip 
                WHERE eip.investor_code = wi.investor_code 
                  AND eip.trade_date = p_trade_date), 0)
      - ABS(LEAST(wi.closing_balance, 0))
      - wi.cumulative_interest < 0
    )
  INTO v_total_equity, v_negative_equity_count
  FROM tmp_with_interest wi;

  -- Count investors with RM and department
  SELECT 
    COUNT(*) FILTER (WHERE rm_id IS NOT NULL AND rm_id != ''),
    COUNT(*) FILTER (WHERE department IS NOT NULL AND department != '')
  INTO v_with_rm_assigned, v_with_department
  FROM tmp_with_interest;

  -- Count unique instruments priced
  SELECT COUNT(DISTINCT instrument)
  INTO v_instruments_priced
  FROM eod_instrument_position
  WHERE trade_date = p_trade_date;

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
$$;