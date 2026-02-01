-- Fix run_batch_eod: RETURNING clause references 'commission' but table has 'total_commission'
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing EOD data for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Create snapshots with baseline-priority opening balance
  WITH 
  base_investors AS MATERIALIZED (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.brokerage_commission,
      i.interest_rate,
      i.account_type,
      i.rm_id,
      i.rm_name,
      i.department,
      i.ledger_balance as master_ledger_balance,
      e.email as rm_email
    FROM investors i
    LEFT JOIN employees e ON LOWER(TRIM(e.employee_id)) = LOWER(TRIM(i.rm_id))
  ),
  -- Priority chain: eod_investor_balance -> eod_ledger_snapshots -> investors.ledger_balance -> 0
  prior_eod AS MATERIALIZED (
    SELECT 
      bi.investor_code,
      COALESCE(
        eib.closing_ledger_balance,
        prev_snap.closing_balance,
        bi.master_ledger_balance,
        0
      ) AS closing_balance,
      COALESCE(prev_snap.cumulative_interest, 0) AS cumulative_interest
    FROM base_investors bi
    LEFT JOIN eod_investor_balance eib 
      ON bi.investor_code = eib.investor_code 
      AND eib.trade_date = p_eod_date - INTERVAL '1 day'
    LEFT JOIN LATERAL (
      SELECT closing_balance, cumulative_interest
      FROM eod_ledger_snapshots
      WHERE investor_code = bi.investor_code 
        AND eod_date < p_eod_date
      ORDER BY eod_date DESC
      LIMIT 1
    ) prev_snap ON TRUE
  ),
  trade_agg AS MATERIALIZED (
    SELECT
      tf.investor_code,
      SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) as gross_sell,
      -- Use actual commission from trade_file if available, else calculate
      SUM(
        CASE 
          WHEN COALESCE(tf.commission, 0) > 0 THEN tf.commission
          ELSE (tf.qty * tf.price) * 
               CASE 
                 WHEN bi.brokerage_commission >= 0.1 THEN bi.brokerage_commission / 100
                 WHEN bi.brokerage_commission > 0 AND bi.brokerage_commission < 0.1 THEN bi.brokerage_commission
                 ELSE 0.004
               END
        END
      ) as total_commission
    FROM trade_file tf
    JOIN base_investors bi ON tf.investor_code = bi.investor_code
    WHERE tf.trade_date = p_eod_date
    GROUP BY tf.investor_code
  ),
  cash_agg AS MATERIALIZED (
    SELECT
      investor_code,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('DEPOSIT', 'CREDIT') THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL', 'DEBIT') THEN ABS(amount) ELSE 0 END), 0) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_eod_date
    GROUP BY investor_code
  ),
  snapshots AS (
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
      COALESCE(ta.total_commission, 0) as total_commission,
      COALESCE(ca.deposits, 0) as deposits,
      COALESCE(ca.withdrawals, 0) as withdrawals,
      COALESCE(pe.closing_balance, 0)
        + COALESCE(ca.deposits, 0)
        - COALESCE(ca.withdrawals, 0)
        + COALESCE(ta.gross_sell, 0)
        - COALESCE(ta.gross_buy, 0)
        - COALESCE(ta.total_commission, 0) as closing_balance
    FROM base_investors bi
    LEFT JOIN prior_eod pe ON bi.investor_code = pe.investor_code
    LEFT JOIN trade_agg ta ON bi.investor_code = ta.investor_code
    LEFT JOIN cash_agg ca ON bi.investor_code = ca.investor_code
  ),
  with_interest AS (
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
    FROM snapshots s
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
      wi.total_commission,
      wi.deposits,
      wi.withdrawals,
      wi.daily_interest,
      wi.cumulative_interest,
      wi.closing_balance,
      auth.uid()
    FROM with_interest wi
    RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission, deposits, withdrawals
  )
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(deposits), 0),
    COALESCE(SUM(withdrawals), 0)
  INTO 
    v_clients_captured,
    v_total_ledger_balance,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals
  FROM inserted;

  -- Count trade files and deposit records
  SELECT COUNT(*) INTO v_trade_files_count FROM trade_file WHERE trade_date = p_eod_date;
  SELECT COUNT(*) INTO v_deposit_records_count FROM cash_ledger_txn WHERE txn_date = p_eod_date;

  -- Record the run in history
  INSERT INTO eod_run_history (
    run_date, run_at, run_by, run_by_email, clients_captured, total_ledger_balance,
    trade_files_count, deposit_records_count, gross_buy, gross_sell,
    total_commission, total_deposits, total_withdrawals, status
  )
  VALUES (
    p_eod_date, now(), auth.uid(), 
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_clients_captured, v_total_ledger_balance,
    v_trade_files_count, v_deposit_records_count, v_gross_buy, v_gross_sell,
    v_total_commission, v_total_deposits, v_total_withdrawals, 'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;

-- Also fix process_staged_trades for consistency (same commission naming issue)
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_snapshots_created INTEGER := 0;
  v_trade_count INTEGER := 0;
  v_deposit_count INTEGER := 0;
  v_withdrawal_count INTEGER := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_interest_rate NUMERIC := 0.12;
  v_daily_rate NUMERIC;
  v_result jsonb;
BEGIN
  v_daily_rate := v_interest_rate / 365;

  -- Delete existing EOD records for this date to allow re-processing
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;

  -- Create temp table for base investors
  CREATE TEMP TABLE tmp_base_investors ON COMMIT DROP AS
  SELECT DISTINCT investor_code
  FROM (
    SELECT investor_code FROM trade_file WHERE trade_date = p_trade_date
    UNION
    SELECT investor_code FROM cash_ledger_txn WHERE txn_date = p_trade_date
    UNION
    SELECT investor_code FROM balances_raw
    UNION
    SELECT investor_code FROM investors
  ) all_investors;

  CREATE INDEX ON tmp_base_investors(investor_code);

  -- Get prior EOD data with baseline priority
  CREATE TEMP TABLE tmp_prior_eod ON COMMIT DROP AS
  SELECT 
    bi.investor_code,
    COALESCE(
      eib.closing_ledger_balance,
      prev_snap.closing_balance,
      i.ledger_balance,
      0
    ) AS closing_balance,
    COALESCE(prev_snap.cumulative_interest, 0) AS cumulative_interest
  FROM tmp_base_investors bi
  LEFT JOIN investors i ON bi.investor_code = i.investor_code
  LEFT JOIN eod_investor_balance eib 
    ON bi.investor_code = eib.investor_code 
    AND eib.trade_date = p_trade_date - INTERVAL '1 day'
  LEFT JOIN LATERAL (
    SELECT closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE investor_code = bi.investor_code 
      AND eod_date < p_trade_date
    ORDER BY eod_date DESC
    LIMIT 1
  ) prev_snap ON TRUE;

  CREATE INDEX ON tmp_prior_eod(investor_code);

  -- Aggregate trades with commission handling
  CREATE TEMP TABLE tmp_trades ON COMMIT DROP AS
  SELECT 
    tf.investor_code,
    SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) AS gross_sell,
    SUM(
      CASE 
        WHEN COALESCE(tf.commission, 0) > 0 THEN tf.commission
        ELSE (tf.qty * tf.price) * 
             CASE 
               WHEN i.brokerage_commission IS NULL THEN 0.004
               WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
               ELSE i.brokerage_commission
             END
      END
    ) AS total_commission,
    COUNT(*) AS trade_count
  FROM trade_file tf
  LEFT JOIN investors i ON tf.investor_code = i.investor_code
  WHERE tf.trade_date = p_trade_date
  GROUP BY tf.investor_code;

  CREATE INDEX ON tmp_trades(investor_code);

  -- Aggregate cash transactions
  CREATE TEMP TABLE tmp_cash ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(CASE WHEN UPPER(TRIM(type)) IN ('DEPOSIT', 'CREDIT') THEN amount ELSE 0 END) AS total_deposits,
    SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAWAL', 'WITHDRAW', 'DEBIT') THEN ABS(amount) ELSE 0 END) AS total_withdrawals,
    COUNT(*) AS txn_count
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX ON tmp_cash(investor_code);

  -- Get investor metadata with employee lookup for RM info
  CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
  SELECT 
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
  LEFT JOIN employees e ON LOWER(i.rm_id) = LOWER(e.employee_id)
     OR LOWER(i.rm_name) = LOWER(e.name);

  CREATE INDEX ON tmp_investor_meta(investor_code);

  -- Get latest balances_raw for position data
  CREATE TEMP TABLE tmp_balances ON COMMIT DROP AS
  SELECT DISTINCT ON (investor_code)
    investor_code,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    total_mv,
    matured_balance,
    receivable_sale,
    cq_in_transit
  FROM balances_raw
  ORDER BY investor_code, as_of_date DESC;

  CREATE INDEX ON tmp_balances(investor_code);

  -- Calculate and insert snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_id,
    rm_name,
    rm_email,
    department,
    account_type,
    opening_balance,
    gross_buy,
    gross_sell,
    net_trade_value,
    total_commission,
    brokerage_rate,
    total_deposits,
    total_withdrawals,
    closing_balance,
    accrued_interest,
    cumulative_interest,
    interest_rate,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    total_mv,
    matured_balance,
    receivable_sale,
    cq_in_transit,
    ledger_balance,
    created_by
  )
  SELECT
    p_trade_date,
    bi.investor_code,
    im.investor_name,
    im.rm_id,
    im.rm_name,
    im.rm_email,
    im.department,
    im.account_type,
    COALESCE(pe.closing_balance, 0),
    COALESCE(t.gross_buy, 0),
    COALESCE(t.gross_sell, 0),
    COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0),
    COALESCE(t.total_commission, 0),
    CASE 
      WHEN im.brokerage_commission IS NULL THEN 0.004
      WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
      ELSE im.brokerage_commission
    END,
    COALESCE(c.total_deposits, 0),
    COALESCE(c.total_withdrawals, 0),
    -- Closing balance
    COALESCE(pe.closing_balance, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.gross_buy, 0) 
      - COALESCE(t.total_commission, 0)
      + COALESCE(c.total_deposits, 0) 
      - COALESCE(c.total_withdrawals, 0),
    -- Accrued interest
    CASE 
      WHEN (COALESCE(pe.closing_balance, 0) 
            + COALESCE(t.gross_sell, 0) 
            - COALESCE(t.gross_buy, 0) 
            - COALESCE(t.total_commission, 0)
            + COALESCE(c.total_deposits, 0) 
            - COALESCE(c.total_withdrawals, 0)) < 0 
      THEN ABS(COALESCE(pe.closing_balance, 0) 
               + COALESCE(t.gross_sell, 0) 
               - COALESCE(t.gross_buy, 0) 
               - COALESCE(t.total_commission, 0)
               + COALESCE(c.total_deposits, 0) 
               - COALESCE(c.total_withdrawals, 0)) * v_daily_rate
      ELSE 0
    END,
    -- Cumulative interest
    COALESCE(pe.cumulative_interest, 0) + 
    CASE 
      WHEN (COALESCE(pe.closing_balance, 0) 
            + COALESCE(t.gross_sell, 0) 
            - COALESCE(t.gross_buy, 0) 
            - COALESCE(t.total_commission, 0)
            + COALESCE(c.total_deposits, 0) 
            - COALESCE(c.total_withdrawals, 0)) < 0 
      THEN ABS(COALESCE(pe.closing_balance, 0) 
               + COALESCE(t.gross_sell, 0) 
               - COALESCE(t.gross_buy, 0) 
               - COALESCE(t.total_commission, 0)
               + COALESCE(c.total_deposits, 0) 
               - COALESCE(c.total_withdrawals, 0)) * v_daily_rate
      ELSE 0
    END,
    COALESCE(im.investor_interest_rate, v_interest_rate),
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.total_mv, 0),
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    COALESCE(pe.closing_balance, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.gross_buy, 0) 
      - COALESCE(t.total_commission, 0)
      + COALESCE(c.total_deposits, 0) 
      - COALESCE(c.total_withdrawals, 0),
    auth.uid()
  FROM tmp_base_investors bi
  LEFT JOIN tmp_prior_eod pe ON bi.investor_code = pe.investor_code
  LEFT JOIN tmp_trades t ON bi.investor_code = t.investor_code
  LEFT JOIN tmp_cash c ON bi.investor_code = c.investor_code
  LEFT JOIN tmp_investor_meta im ON bi.investor_code = im.investor_code
  LEFT JOIN tmp_balances b ON bi.investor_code = b.investor_code;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Get aggregated stats
  SELECT 
    COALESCE(SUM(trade_count), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO v_trade_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM tmp_trades;

  SELECT 
    COUNT(*) FILTER (WHERE UPPER(TRIM(type)) IN ('DEPOSIT', 'CREDIT')),
    COUNT(*) FILTER (WHERE UPPER(TRIM(type)) IN ('WITHDRAWAL', 'WITHDRAW', 'DEBIT')),
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('DEPOSIT', 'CREDIT') THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(TRIM(type)) IN ('WITHDRAWAL', 'WITHDRAW', 'DEBIT') THEN ABS(amount) ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Get total ledger balance from snapshots
  SELECT COALESCE(SUM(closing_balance), 0)
  INTO v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- Record in eod_run_history for audit trail
  INSERT INTO eod_run_history (
    run_date, 
    run_at, 
    run_by, 
    run_by_email, 
    clients_captured, 
    total_ledger_balance,
    trade_files_count, 
    deposit_records_count, 
    gross_buy, 
    gross_sell,
    total_commission, 
    total_deposits, 
    total_withdrawals, 
    status,
    notes
  )
  VALUES (
    p_trade_date, 
    now(), 
    auth.uid(), 
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_snapshots_created,
    v_total_ledger_balance,
    v_trade_count,
    v_deposit_count + v_withdrawal_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals,
    'completed',
    'Processed via staged trades'
  );

  v_result := jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'snapshots_created', v_snapshots_created,
    'trade_count', v_trade_count,
    'deposit_count', v_deposit_count,
    'withdrawal_count', v_withdrawal_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'total_ledger_balance', v_total_ledger_balance
  );

  RETURN v_result;
END;
$$;