-- Update process_staged_trades to record in eod_run_history
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  -- Calculate daily interest rate
  v_daily_rate := v_interest_rate / 365;

  -- Delete existing EOD records for this date to allow re-processing
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;

  -- Create temp table for base investors (all investors that have any activity)
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
      -- Priority 1: Official baseline from eod_investor_balance (previous day)
      eib.closing_ledger_balance,
      -- Priority 2: Prior snapshot chain
      prev_snap.closing_balance,
      -- Priority 3: Investors table baseline
      i.ledger_balance,
      -- Priority 4: Default
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

  -- Aggregate trades
  CREATE TEMP TABLE tmp_trades ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(CASE WHEN side = 'B' THEN qty * price + COALESCE(commission, 0) ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN side = 'S' THEN qty * price - COALESCE(commission, 0) ELSE 0 END) AS gross_sell,
    SUM(COALESCE(commission, 0)) AS total_commission,
    COUNT(*) AS trade_count
  FROM trade_file
  WHERE trade_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX ON tmp_trades(investor_code);

  -- Aggregate cash transactions
  CREATE TEMP TABLE tmp_cash ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(CASE WHEN type IN ('DEPOSIT', 'CREDIT') THEN amount ELSE 0 END) AS total_deposits,
    SUM(CASE WHEN type IN ('WITHDRAWAL', 'DEBIT') THEN ABS(amount) ELSE 0 END) AS total_withdrawals,
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
    -- Opening balance
    COALESCE(pe.closing_balance, 0),
    -- Trade values
    COALESCE(t.gross_buy, 0),
    COALESCE(t.gross_sell, 0),
    COALESCE(t.gross_sell, 0) - COALESCE(t.gross_buy, 0),
    -- Commission - calculate from trades using investor's brokerage rate
    CASE 
      WHEN COALESCE(t.total_commission, 0) > 0 THEN t.total_commission
      ELSE (COALESCE(t.gross_buy, 0) + COALESCE(t.gross_sell, 0)) * 
           CASE 
             WHEN im.brokerage_commission IS NULL THEN 0.004
             WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
             ELSE im.brokerage_commission
           END
    END,
    -- Brokerage rate
    CASE 
      WHEN im.brokerage_commission IS NULL THEN 0.004
      WHEN im.brokerage_commission >= 0.1 THEN im.brokerage_commission / 100
      ELSE im.brokerage_commission
    END,
    -- Cash movements
    COALESCE(c.total_deposits, 0),
    COALESCE(c.total_withdrawals, 0),
    -- Closing balance
    COALESCE(pe.closing_balance, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.gross_buy, 0) 
      + COALESCE(c.total_deposits, 0) 
      - COALESCE(c.total_withdrawals, 0),
    -- Accrued interest (only for negative balances)
    CASE 
      WHEN (COALESCE(pe.closing_balance, 0) 
            + COALESCE(t.gross_sell, 0) 
            - COALESCE(t.gross_buy, 0) 
            + COALESCE(c.total_deposits, 0) 
            - COALESCE(c.total_withdrawals, 0)) < 0 
      THEN ABS(COALESCE(pe.closing_balance, 0) 
               + COALESCE(t.gross_sell, 0) 
               - COALESCE(t.gross_buy, 0) 
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
            + COALESCE(c.total_deposits, 0) 
            - COALESCE(c.total_withdrawals, 0)) < 0 
      THEN ABS(COALESCE(pe.closing_balance, 0) 
               + COALESCE(t.gross_sell, 0) 
               - COALESCE(t.gross_buy, 0) 
               + COALESCE(c.total_deposits, 0) 
               - COALESCE(c.total_withdrawals, 0)) * v_daily_rate
      ELSE 0
    END,
    COALESCE(im.investor_interest_rate, v_interest_rate),
    -- Position data from balances_raw
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.total_mv, 0),
    COALESCE(b.matured_balance, 0),
    COALESCE(b.receivable_sale, 0),
    COALESCE(b.cq_in_transit, 0),
    -- Ledger balance (same as closing for consistency)
    COALESCE(pe.closing_balance, 0) 
      + COALESCE(t.gross_sell, 0) 
      - COALESCE(t.gross_buy, 0) 
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
    COALESCE(SUM(gross_sell), 0)
  INTO v_trade_count, v_gross_buy, v_gross_sell
  FROM tmp_trades;

  SELECT 
    COUNT(*) FILTER (WHERE type IN ('DEPOSIT', 'CREDIT')),
    COUNT(*) FILTER (WHERE type IN ('WITHDRAWAL', 'DEBIT')),
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'CREDIT') THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAWAL', 'DEBIT') THEN ABS(amount) ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Calculate total commission from snapshots
  SELECT COALESCE(SUM(total_commission), 0), COALESCE(SUM(closing_balance), 0)
  INTO v_total_commission, v_total_ledger_balance
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

  -- Build result
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

-- Backfill Feb 1 record from existing snapshots
INSERT INTO eod_run_history (
  run_date, run_at, clients_captured, total_ledger_balance,
  trade_files_count, gross_buy, gross_sell, total_commission,
  total_deposits, total_withdrawals, status, notes
)
SELECT 
  '2026-02-01'::date,
  '2026-02-01 20:07:27+00'::timestamptz,
  COUNT(*)::integer,
  SUM(closing_balance),
  (SELECT COUNT(*)::integer FROM trade_file WHERE trade_date = '2026-02-01'),
  SUM(gross_buy),
  SUM(gross_sell),
  SUM(total_commission),
  SUM(total_deposits),
  SUM(total_withdrawals),
  'completed',
  'Backfilled from existing snapshots'
FROM eod_ledger_snapshots
WHERE eod_date = '2026-02-01'
AND NOT EXISTS (
  SELECT 1 FROM eod_run_history WHERE run_date = '2026-02-01'
);