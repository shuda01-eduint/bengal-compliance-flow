-- Fix process_staged_trades: trade_file has no `value` column; compute trade value as qty * price

CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '600s'
SET lock_timeout TO '120s'
AS $$
DECLARE
  v_prev_date DATE;
  v_next_date DATE;
  v_trade_count INT := 0;
  v_investor_count INT := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_deposit_count INT := 0;
  v_withdrawal_count INT := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_instruments_priced INT := 0;
  v_positions_captured INT := 0;
  v_total_market_value NUMERIC := 0;
  v_snapshots_created INT := 0;
  v_margin_accounts INT := 0;
  v_margin_exposure NUMERIC := 0;
  v_daily_interest_total NUMERIC := 0;
  v_cumulative_interest_total NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_negative_equity_count INT := 0;
  v_with_rm_assigned INT := 0;
  v_with_department INT := 0;
  v_next_day_updated INT := 0;
BEGIN
  -- Calculate previous and next dates
  v_prev_date := p_trade_date - 1;
  v_next_date := p_trade_date + 1;

  -- Acquire advisory lock to prevent concurrent runs
  IF NOT pg_try_advisory_xact_lock(hashtext('process_staged_trades_' || p_trade_date::text)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Another EOD process is running for this date',
      'error_detail', 'Please wait and try again'
    );
  END IF;

  -- STEP 0: Delete existing snapshots for this date (allow re-run)
  DELETE FROM public.eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM public.eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM public.eod_run_history WHERE run_date = p_trade_date;

  -- STEP 1: Count staged trades
  SELECT COUNT(*), 
         COALESCE(SUM(CASE WHEN side IN ('B', 'BUY') THEN (qty * price) ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN side IN ('S', 'SELL') THEN (qty * price) ELSE 0 END), 0),
         COALESCE(SUM(commission), 0)
  INTO v_trade_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM public.trade_file
  WHERE trade_date = p_trade_date;

  -- STEP 2: Count deposits/withdrawals
  SELECT 
    COUNT(*) FILTER (WHERE type IN ('DEPOSIT')),
    COUNT(*) FILTER (WHERE type IN ('WITHDRAW', 'WITHDRAWAL')),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('DEPOSIT')), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('WITHDRAW', 'WITHDRAWAL')), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM public.cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- STEP 3: Create temp table with all investors who have activity or existing snapshots
  CREATE TEMP TABLE tmp_active_investors ON COMMIT DROP AS
  SELECT DISTINCT investor_code FROM (
    SELECT investor_code FROM public.trade_file WHERE trade_date = p_trade_date
    UNION
    SELECT investor_code FROM public.cash_ledger_txn WHERE txn_date = p_trade_date
    UNION
    SELECT investor_code FROM public.investors WHERE investor_code IS NOT NULL
  ) sub
  WHERE investor_code IS NOT NULL;

  CREATE INDEX idx_tmp_active_inv ON tmp_active_investors(investor_code);

  -- STEP 4: Get opening balances with correct priority chain
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
  LEFT JOIN public.eod_investor_balance ob 
    ON ai.investor_code = ob.investor_code 
    AND ob.trade_date = v_prev_date
  LEFT JOIN public.eod_ledger_snapshots ls 
    ON ai.investor_code = ls.investor_code 
    AND ls.eod_date = v_prev_date
  LEFT JOIN public.investors inv 
    ON ai.investor_code = inv.investor_code;

  CREATE INDEX idx_tmp_ob ON tmp_opening_balances(investor_code);

  -- STEP 5: Aggregate trades per investor
  CREATE TEMP TABLE tmp_trade_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(CASE WHEN side IN ('B', 'BUY') THEN (qty * price) ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN side IN ('S', 'SELL') THEN (qty * price) ELSE 0 END) AS gross_sell,
    SUM(commission) AS total_commission
  FROM public.trade_file
  WHERE trade_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX idx_tmp_ta ON tmp_trade_agg(investor_code);

  -- STEP 6: Aggregate cash flows per investor
  CREATE TEMP TABLE tmp_cash_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(CASE WHEN type IN ('DEPOSIT') THEN amount ELSE 0 END) AS total_deposits,
    SUM(CASE WHEN type IN ('WITHDRAW', 'WITHDRAWAL') THEN amount ELSE 0 END) AS total_withdrawals
  FROM public.cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX idx_tmp_ca ON tmp_cash_agg(investor_code);

  -- STEP 7: Get investor metadata with RM/department info
  CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
  SELECT DISTINCT ON (i.investor_code)
    i.investor_code,
    i.investor_name,
    i.account_type,
    i.department,
    i.rm_id,
    i.rm_name,
    e.email AS rm_email,
    CASE 
      WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
      WHEN i.brokerage_commission IS NOT NULL AND i.brokerage_commission > 0 THEN i.brokerage_commission
      ELSE 0.004
    END AS brokerage_rate,
    COALESCE(i.interest_rate, 15) AS interest_rate
  FROM public.investors i
  LEFT JOIN public.employees e ON (
    i.rm_id = e.employee_id 
    OR (e.employee_id IS NULL AND LOWER(i.rm_name) = LOWER(e.name))
  )
  WHERE i.investor_code IS NOT NULL
  ORDER BY i.investor_code, 
    CASE WHEN i.rm_id = e.employee_id THEN 0 ELSE 1 END;

  CREATE INDEX idx_tmp_im ON tmp_investor_meta(investor_code);

  -- STEP 8: Build final snapshot data
  CREATE TEMP TABLE tmp_snapshots ON COMMIT DROP AS
  SELECT 
    ob.investor_code,
    COALESCE(im.investor_name, '') AS investor_name,
    COALESCE(im.account_type, 'Regular') AS account_type,
    COALESCE(im.department, '') AS department,
    COALESCE(im.rm_id, '') AS rm_id,
    COALESCE(im.rm_name, '') AS rm_name,
    COALESCE(im.rm_email, '') AS rm_email,
    COALESCE(im.brokerage_rate, 0.004) AS brokerage_rate,
    COALESCE(im.interest_rate, 15) AS interest_rate,
    ob.opening_balance,
    COALESCE(ta.gross_buy, 0) AS gross_buy,
    COALESCE(ta.gross_sell, 0) AS gross_sell,
    COALESCE(ta.total_commission, 0) AS staged_commission,
    COALESCE(ca.total_deposits, 0) AS total_deposits,
    COALESCE(ca.total_withdrawals, 0) AS total_withdrawals,
    ob.cumulative_interest,
    -- Calculate closing balance: opening + sells - buys - commission + deposits - withdrawals
    ob.opening_balance 
      + COALESCE(ta.gross_sell, 0) 
      - COALESCE(ta.gross_buy, 0) 
      - COALESCE(ta.total_commission, 0)
      + COALESCE(ca.total_deposits, 0) 
      - COALESCE(ca.total_withdrawals, 0) AS closing_balance
  FROM tmp_opening_balances ob
  LEFT JOIN tmp_trade_agg ta ON ob.investor_code = ta.investor_code
  LEFT JOIN tmp_cash_agg ca ON ob.investor_code = ca.investor_code
  LEFT JOIN tmp_investor_meta im ON ob.investor_code = im.investor_code;

  CREATE INDEX idx_tmp_snap ON tmp_snapshots(investor_code);

  -- STEP 9: Calculate daily interest for margin accounts (negative balance)
  UPDATE tmp_snapshots
  SET cumulative_interest = cumulative_interest + 
    CASE 
      WHEN closing_balance < 0 THEN 
        ABS(closing_balance) * (interest_rate / 100 / 365)
      ELSE 0 
    END
  WHERE investor_code IS NOT NULL;

  -- STEP 10: Get instrument prices for the date
  CREATE TEMP TABLE tmp_prices ON COMMIT DROP AS
  SELECT instrument, eod_price
  FROM public.instrument_prices_eod
  WHERE trade_date = p_trade_date;

  CREATE INDEX idx_tmp_pr ON tmp_prices(instrument);

  SELECT COUNT(*) INTO v_instruments_priced FROM tmp_prices;

  -- STEP 11: Build instrument positions from holdings + trades
  CREATE TEMP TABLE tmp_positions ON COMMIT DROP AS
  SELECT 
    h.investor_code,
    h.trading_code AS instrument,
    COALESCE(h.total_stock, 0) AS total_stock,
    COALESCE(h.saleable, 0) AS saleable,
    COALESCE(h.avg_cost, 0) AS avg_cost,
    COALESCE(h.total_cost, 0) AS total_cost,
    COALESCE(h.total_stock, 0) * COALESCE(p.eod_price, h.avg_cost) AS market_value
  FROM public.holdings h
  LEFT JOIN tmp_prices p ON h.trading_code = p.instrument
  WHERE h.investor_code IN (SELECT investor_code FROM tmp_active_investors);

  SELECT COUNT(*) INTO v_positions_captured FROM tmp_positions;

  -- STEP 12: Calculate total market value per investor
  CREATE TEMP TABLE tmp_mv_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(market_value) AS total_mv
  FROM tmp_positions
  GROUP BY investor_code;

  SELECT COALESCE(SUM(total_mv), 0) INTO v_total_market_value FROM tmp_mv_agg;

  -- STEP 13: Insert snapshots
  INSERT INTO public.eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    account_type,
    department,
    rm_id,
    rm_name,
    rm_email,
    brokerage_rate,
    interest_rate,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    closing_balance,
    ledger_balance,
    cumulative_interest,
    accrued_interest,
    total_mv,
    created_by
  )
  SELECT 
    p_trade_date,
    s.investor_code,
    s.investor_name,
    s.account_type,
    s.department,
    s.rm_id,
    s.rm_name,
    s.rm_email,
    s.brokerage_rate,
    s.interest_rate,
    s.opening_balance,
    s.gross_buy,
    s.gross_sell,
    CASE 
      WHEN s.staged_commission > 0 THEN s.staged_commission
      ELSE (s.gross_buy + s.gross_sell) * s.brokerage_rate
    END,
    s.total_deposits,
    s.total_withdrawals,
    s.closing_balance,
    s.closing_balance,
    s.cumulative_interest,
    CASE WHEN s.closing_balance < 0 THEN 
      ABS(s.closing_balance) * (s.interest_rate / 100 / 365)
    ELSE 0 END,
    COALESCE(mv.total_mv, 0),
    auth.uid()
  FROM tmp_snapshots s
  LEFT JOIN tmp_mv_agg mv ON s.investor_code = mv.investor_code;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- STEP 14: Insert instrument positions
  INSERT INTO public.eod_instrument_position (
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
  FROM tmp_positions
  WHERE total_stock > 0;

  -- STEP 15: Calculate summary stats
  SELECT 
    COUNT(*) FILTER (WHERE rm_id IS NOT NULL AND rm_id != ''),
    COUNT(*) FILTER (WHERE department IS NOT NULL AND department != ''),
    COUNT(*) FILTER (WHERE closing_balance < 0),
    COALESCE(SUM(ABS(closing_balance)) FILTER (WHERE closing_balance < 0), 0),
    COALESCE(SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) * (interest_rate / 100 / 365) ELSE 0 END), 0),
    COALESCE(SUM(cumulative_interest), 0)
  INTO 
    v_with_rm_assigned,
    v_with_department,
    v_margin_accounts,
    v_margin_exposure,
    v_daily_interest_total,
    v_cumulative_interest_total
  FROM tmp_snapshots;

  -- Calculate equity
  SELECT 
    COALESCE(SUM(
      COALESCE(mv.total_mv, 0) 
      - CASE WHEN s.closing_balance < 0 THEN ABS(s.closing_balance) ELSE 0 END
      - s.cumulative_interest
    ), 0),
    COUNT(*) FILTER (WHERE 
      COALESCE(mv.total_mv, 0) 
      - CASE WHEN s.closing_balance < 0 THEN ABS(s.closing_balance) ELSE 0 END
      - s.cumulative_interest < 0
    )
  INTO v_total_equity, v_negative_equity_count
  FROM tmp_snapshots s
  LEFT JOIN tmp_mv_agg mv ON s.investor_code = mv.investor_code;

  v_investor_count := v_snapshots_created;

  -- STEP 16: Insert EOD run history
  INSERT INTO public.eod_run_history (
    run_date,
    status,
    clients_captured,
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    run_by,
    run_by_email
  )
  SELECT 
    p_trade_date,
    'completed',
    v_snapshots_created,
    COALESCE(SUM(closing_balance), 0),
    v_trade_count,
    v_deposit_count + v_withdrawal_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid())
  FROM tmp_snapshots;

  -- STEP 17: Propagate closing balances to NEXT day's opening balances
  INSERT INTO public.eod_investor_balance (
    trade_date,
    investor_code,
    opening_ledger_balance,
    closing_ledger_balance,
    matured_balance,
    receivable_sales,
    cheque_in_tran_hand,
    accrued_int,
    equity,
    rm_id
  )
  SELECT 
    v_next_date,
    s.investor_code,
    s.closing_balance,
    s.closing_balance,
    0,
    0,
    0,
    s.cumulative_interest,
    COALESCE(mv.total_mv, 0) - CASE WHEN s.closing_balance < 0 THEN ABS(s.closing_balance) ELSE 0 END - s.cumulative_interest,
    NULLIF(s.rm_id, '')
  FROM tmp_snapshots s
  LEFT JOIN tmp_mv_agg mv ON s.investor_code = mv.investor_code
  WHERE s.investor_code IS NOT NULL
  ON CONFLICT (trade_date, investor_code) 
  DO UPDATE SET 
    opening_ledger_balance = EXCLUDED.opening_ledger_balance,
    accrued_int = EXCLUDED.accrued_int,
    equity = EXCLUDED.equity,
    rm_id = EXCLUDED.rm_id;

  GET DIAGNOSTICS v_next_day_updated = ROW_COUNT;

  -- Return success
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
    'with_department', v_with_department,
    'next_day_balances_updated', v_next_day_updated
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;