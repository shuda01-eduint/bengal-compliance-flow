CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '600s'
SET lock_timeout TO '120s'
AS $$
DECLARE
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
  v_prev_date DATE;
  v_next_date DATE;
BEGIN
  -- Calculate previous and next dates
  v_prev_date := p_trade_date - 1;
  v_next_date := p_trade_date + 1;

  -- Acquire advisory lock to prevent concurrent runs
  IF NOT pg_try_advisory_xact_lock(hashtext('process_staged_trades_' || p_trade_date::TEXT)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Another EOD process is running for this date',
      'trade_date', p_trade_date
    );
  END IF;

  -- Delete existing snapshots for this date
  DELETE FROM public.eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM public.eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM public.eod_run_history WHERE run_date = p_trade_date;
  -- Delete next-day propagated balances so we can re-create them
  DELETE FROM public.eod_investor_balance WHERE trade_date = v_next_date;

  -- STEP 1: Get trade statistics with CALCULATED commission
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN side IN ('B', 'BUY') THEN (qty * price) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side IN ('S', 'SELL') THEN (qty * price) ELSE 0 END), 0),
    COALESCE(SUM(
      CASE 
        WHEN tf.commission > 0 THEN tf.commission
        ELSE (tf.qty * tf.price) * 
          CASE 
            WHEN i.brokerage_commission IS NULL THEN 0.004
            WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
            ELSE i.brokerage_commission
          END
      END
    ), 0)
  INTO v_trade_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM public.trade_file tf
  LEFT JOIN public.investors i ON tf.investor_code = i.investor_code
  WHERE tf.trade_date = p_trade_date;

  -- STEP 2: Get deposit/withdrawal statistics
  SELECT 
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'DEP') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAW', 'WITHDRAWAL', 'WDR') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'DEP') THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAW', 'WITHDRAWAL', 'WDR') THEN amount ELSE 0 END), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM public.cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- STEP 3: Create temp table for opening balances with priority chain
  CREATE TEMP TABLE tmp_opening_balances ON COMMIT DROP AS
  SELECT 
    COALESCE(ob.investor_code, ls.investor_code, inv.investor_code) AS investor_code,
    -- Priority 1: Official baseline, Priority 2: Snapshot chain, Priority 3: Master table
    COALESCE(ob.closing_ledger_balance, ls.closing_balance, inv.ledger_balance, 0) AS opening_balance,
    COALESCE(ls.cumulative_interest, 0) AS cumulative_interest
  FROM public.investors inv
  LEFT JOIN public.eod_investor_balance ob 
    ON inv.investor_code = ob.investor_code 
    AND ob.trade_date = v_prev_date
  LEFT JOIN public.eod_ledger_snapshots ls 
    ON inv.investor_code = ls.investor_code 
    AND ls.eod_date = v_prev_date;

  CREATE INDEX idx_tmp_opening_investor ON tmp_opening_balances(investor_code);

  -- STEP 4: Create temp table for trade aggregates with CALCULATED commission
  CREATE TEMP TABLE tmp_trade_agg ON COMMIT DROP AS
  SELECT 
    tf.investor_code,
    COALESCE(SUM(CASE WHEN side IN ('B', 'BUY') THEN (qty * price) ELSE 0 END), 0) AS gross_buy,
    COALESCE(SUM(CASE WHEN side IN ('S', 'SELL') THEN (qty * price) ELSE 0 END), 0) AS gross_sell,
    COALESCE(SUM(
      CASE 
        WHEN tf.commission > 0 THEN tf.commission
        ELSE (tf.qty * tf.price) * 
          CASE 
            WHEN i.brokerage_commission IS NULL THEN 0.004
            WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
            ELSE i.brokerage_commission
          END
      END
    ), 0) AS total_commission,
    COUNT(*) AS trade_count
  FROM public.trade_file tf
  LEFT JOIN public.investors i ON tf.investor_code = i.investor_code
  WHERE tf.trade_date = p_trade_date
  GROUP BY tf.investor_code;

  CREATE INDEX idx_tmp_trade_investor ON tmp_trade_agg(investor_code);

  -- STEP 5: Create temp table for cash flow aggregates
  CREATE TEMP TABLE tmp_cash_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    COALESCE(SUM(CASE WHEN type IN ('DEPOSIT', 'DEP') THEN amount ELSE 0 END), 0) AS total_deposits,
    COALESCE(SUM(CASE WHEN type IN ('WITHDRAW', 'WITHDRAWAL', 'WDR') THEN amount ELSE 0 END), 0) AS total_withdrawals
  FROM public.cash_ledger_txn
  WHERE txn_date = p_trade_date
  GROUP BY investor_code;

  CREATE INDEX idx_tmp_cash_investor ON tmp_cash_agg(investor_code);

  -- STEP 6: Get EOD prices
  CREATE TEMP TABLE tmp_prices ON COMMIT DROP AS
  SELECT instrument, eod_price
  FROM public.instrument_prices_eod
  WHERE trade_date = p_trade_date;

  CREATE INDEX idx_tmp_prices_instrument ON tmp_prices(instrument);

  SELECT COUNT(*) INTO v_instruments_priced FROM tmp_prices;

  -- STEP 7: Calculate positions and market values
  CREATE TEMP TABLE tmp_positions ON COMMIT DROP AS
  SELECT 
    h.investor_code,
    h.trading_code AS instrument,
    COALESCE(h.total_stock, 0) AS total_stock,
    COALESCE(h.saleable, 0) AS saleable,
    COALESCE(h.avg_cost, 0) AS avg_cost,
    COALESCE(h.total_cost, 0) AS total_cost,
    COALESCE(h.total_stock, 0) * COALESCE(p.eod_price, h.avg_cost, 0) AS market_value
  FROM public.holdings h
  LEFT JOIN tmp_prices p ON h.trading_code = p.instrument
  WHERE h.total_stock > 0;

  CREATE INDEX idx_tmp_positions_investor ON tmp_positions(investor_code);

  SELECT COUNT(*) INTO v_positions_captured FROM tmp_positions;

  -- STEP 8: Aggregate market values per investor
  CREATE TEMP TABLE tmp_mv_agg ON COMMIT DROP AS
  SELECT 
    investor_code,
    SUM(market_value) AS total_mv,
    SUM(total_cost) AS total_cost
  FROM tmp_positions
  GROUP BY investor_code;

  CREATE INDEX idx_tmp_mv_investor ON tmp_mv_agg(investor_code);

  SELECT COALESCE(SUM(total_mv), 0) INTO v_total_market_value FROM tmp_mv_agg;

  -- STEP 9: Get RM assignments using employees table
  CREATE TEMP TABLE tmp_rm_info ON COMMIT DROP AS
  SELECT DISTINCT ON (i.investor_code)
    i.investor_code,
    e.employee_id AS rm_id,
    e.name AS rm_name,
    e.email AS rm_email,
    e.department
  FROM public.investors i
  LEFT JOIN public.employees e ON (
    i.rm_id = e.employee_id OR 
    i.rm_name = e.name
  )
  WHERE i.investor_code IS NOT NULL
  ORDER BY i.investor_code, 
    CASE WHEN i.rm_id = e.employee_id THEN 0 ELSE 1 END;

  CREATE INDEX idx_tmp_rm_investor ON tmp_rm_info(investor_code);

  -- STEP 10: Build and insert snapshots
  INSERT INTO public.eod_ledger_snapshots (
    eod_date, investor_code, investor_name, rm_id, rm_name, rm_email, department,
    opening_balance, gross_buy, gross_sell, total_commission,
    total_deposits, total_withdrawals, net_trade_value, closing_balance,
    total_mv, total_cost, accrued_interest, cumulative_interest,
    account_type, brokerage_rate, interest_rate, ledger_balance,
    created_by
  )
  SELECT 
    p_trade_date,
    i.investor_code,
    i.investor_name,
    rm.rm_id,
    rm.rm_name,
    rm.rm_email,
    rm.department,
    COALESCE(ob.opening_balance, 0),
    COALESCE(ta.gross_buy, 0),
    COALESCE(ta.gross_sell, 0),
    COALESCE(ta.total_commission, 0),
    COALESCE(ca.total_deposits, 0),
    COALESCE(ca.total_withdrawals, 0),
    -- Net trade value: sells credit, buys debit, commission debits
    COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0),
    -- Closing balance
    COALESCE(ob.opening_balance, 0) 
      + COALESCE(ta.gross_sell, 0) 
      - COALESCE(ta.gross_buy, 0) 
      - COALESCE(ta.total_commission, 0)
      + COALESCE(ca.total_deposits, 0) 
      - COALESCE(ca.total_withdrawals, 0),
    COALESCE(mv.total_mv, 0),
    COALESCE(mv.total_cost, 0),
    -- Daily interest for margin accounts (negative balance)
    CASE 
      WHEN (COALESCE(ob.opening_balance, 0) + COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0) + COALESCE(ca.total_deposits, 0) - COALESCE(ca.total_withdrawals, 0)) < 0
      THEN ABS(COALESCE(ob.opening_balance, 0) + COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0) + COALESCE(ca.total_deposits, 0) - COALESCE(ca.total_withdrawals, 0)) 
           * COALESCE(i.interest_rate, 0.15) / 365
      ELSE 0
    END,
    -- Cumulative interest
    COALESCE(ob.cumulative_interest, 0) + 
    CASE 
      WHEN (COALESCE(ob.opening_balance, 0) + COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0) + COALESCE(ca.total_deposits, 0) - COALESCE(ca.total_withdrawals, 0)) < 0
      THEN ABS(COALESCE(ob.opening_balance, 0) + COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0) + COALESCE(ca.total_deposits, 0) - COALESCE(ca.total_withdrawals, 0)) 
           * COALESCE(i.interest_rate, 0.15) / 365
      ELSE 0
    END,
    i.account_type,
    CASE 
      WHEN i.brokerage_commission IS NULL THEN 0.004
      WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
      ELSE i.brokerage_commission
    END,
    i.interest_rate,
    COALESCE(ob.opening_balance, 0) 
      + COALESCE(ta.gross_sell, 0) 
      - COALESCE(ta.gross_buy, 0) 
      - COALESCE(ta.total_commission, 0)
      + COALESCE(ca.total_deposits, 0) 
      - COALESCE(ca.total_withdrawals, 0),
    auth.uid()
  FROM public.investors i
  LEFT JOIN tmp_opening_balances ob ON i.investor_code = ob.investor_code
  LEFT JOIN tmp_trade_agg ta ON i.investor_code = ta.investor_code
  LEFT JOIN tmp_cash_agg ca ON i.investor_code = ca.investor_code
  LEFT JOIN tmp_mv_agg mv ON i.investor_code = mv.investor_code
  LEFT JOIN tmp_rm_info rm ON i.investor_code = rm.investor_code
  WHERE i.investor_code IS NOT NULL;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- STEP 11: Insert instrument positions
  INSERT INTO public.eod_instrument_position (
    trade_date, investor_code, instrument, total_stock, saleable,
    avg_cost, total_cost, total_market_value
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
  FROM tmp_positions;

  -- STEP 12: Calculate summary statistics from created snapshots
  SELECT 
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(CASE WHEN closing_balance < 0 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END), 0),
    COALESCE(SUM(accrued_interest), 0),
    COALESCE(SUM(cumulative_interest), 0),
    COALESCE(SUM(total_mv - CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END - cumulative_interest), 0),
    COALESCE(SUM(CASE WHEN (total_mv - CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END - cumulative_interest) < 0 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rm_id IS NOT NULL THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN department IS NOT NULL THEN 1 ELSE 0 END), 0)
  INTO 
    v_investor_count, v_margin_accounts, v_margin_exposure,
    v_daily_interest_total, v_cumulative_interest_total, v_total_equity,
    v_negative_equity_count, v_with_rm_assigned, v_with_department
  FROM public.eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- STEP 13: Propagate closing balances to next day's eod_investor_balance
  INSERT INTO public.eod_investor_balance (
    trade_date, investor_code, opening_ledger_balance, closing_ledger_balance,
    rm_id, matured_balance, receivable_sales, cheque_in_tran_hand, accrued_int, equity
  )
  SELECT 
    v_next_date,
    s.investor_code,
    s.closing_balance,
    s.closing_balance,
    NULLIF(s.rm_id, ''),
    0,
    0,
    0,
    s.cumulative_interest,
    COALESCE(mv.total_mv, 0) - CASE WHEN s.closing_balance < 0 THEN ABS(s.closing_balance) ELSE 0 END - s.cumulative_interest
  FROM public.eod_ledger_snapshots s
  LEFT JOIN tmp_mv_agg mv ON s.investor_code = mv.investor_code
  WHERE s.eod_date = p_trade_date
    AND s.investor_code IS NOT NULL
  ON CONFLICT (investor_code, trade_date) DO UPDATE SET
    opening_ledger_balance = EXCLUDED.opening_ledger_balance,
    closing_ledger_balance = EXCLUDED.closing_ledger_balance,
    rm_id = EXCLUDED.rm_id,
    accrued_int = EXCLUDED.accrued_int,
    equity = EXCLUDED.equity;

  -- STEP 14: Record run history
  INSERT INTO public.eod_run_history (
    run_date, status, clients_captured, total_ledger_balance,
    trade_files_count, deposit_records_count,
    gross_buy, gross_sell, total_commission,
    total_deposits, total_withdrawals,
    run_by, run_by_email
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
  FROM public.eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

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
    'error_detail', SQLSTATE,
    'trade_date', p_trade_date
  );
END;
$$;