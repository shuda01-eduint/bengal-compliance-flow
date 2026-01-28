-- Align backend run_batch_eod opening balance logic with frontend
-- Change: Use most recent EOD snapshot (not exact date match) + fallback to investors.ledger_balance

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_user_email text;
  v_error_message text;
  v_error_detail text;
  v_error_hint text;
  v_error_context text;
BEGIN
  -- Security check: Only admins can run EOD
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access denied. Admin role required.',
      'clients_captured', 0
    );
  END IF;

  -- Get user email for audit
  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  -- Count trade files for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = p_eod_date;

  -- Count deposit records from trade_history for this date
  SELECT COUNT(DISTINCT client_code) INTO v_deposit_records_count
  FROM trade_history
  WHERE trade_date = p_eod_date
    AND (COALESCE(total_deposits, 0) > 0 OR COALESCE(total_withdrawals, 0) > 0);

  BEGIN
    -- Main EOD calculation using CTEs
    WITH 
    -- Universe: All investors who should have EOD snapshots
    universe AS (
      SELECT DISTINCT investor_code
      FROM (
        -- Investors with trades on this date
        SELECT client_code AS investor_code FROM trade_history WHERE trade_date = p_eod_date
        UNION
        -- Investors with deposits/withdrawals on this date (legacy support)
        SELECT investor_code FROM deposits_withdrawals WHERE transaction_date = p_eod_date
        UNION
        -- Investors with ANY previous snapshots (chain continuity)
        SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date < p_eod_date
        UNION
        -- All active investors in master data
        SELECT investor_code FROM investors WHERE status = 'Active'
      ) all_investors
    ),
    
    -- UPDATED: Previous balances - use MOST RECENT snapshot before EOD date (not exact date match)
    prev_balances AS (
      SELECT DISTINCT ON (investor_code)
        investor_code,
        closing_balance,
        cumulative_interest
      FROM eod_ledger_snapshots
      WHERE eod_date < p_eod_date
      ORDER BY investor_code, eod_date DESC
    ),
    
    -- Daily deposits/withdrawals from trade_history
    daily_deposits AS (
      SELECT 
        client_code AS investor_code,
        COALESCE(MAX(total_deposits), 0) AS deposits,
        COALESCE(MAX(total_withdrawals), 0) AS withdrawals,
        MAX(ledger_balance_snapshot) AS ledger_snapshot
      FROM trade_history
      WHERE trade_date = p_eod_date
      GROUP BY client_code
    ),
    
    -- Daily trade aggregates
    daily_trades AS (
      SELECT 
        client_code AS investor_code,
        COALESCE(SUM(CASE WHEN side = 'B' THEN gross_value ELSE 0 END), 0) AS gross_buy,
        COALESCE(SUM(CASE WHEN side = 'S' THEN gross_value ELSE 0 END), 0) AS gross_sell,
        COALESCE(SUM(commission), 0) AS total_commission
      FROM trade_history
      WHERE trade_date = p_eod_date
      GROUP BY client_code
    ),
    
    -- UPDATED: Get investor metadata including ledger_balance for fallback
    investor_meta AS (
      SELECT 
        i.investor_code,
        i.investor_name,
        i.account_type,
        i.interest_rate,
        i.brokerage_commission,
        i.rm_id,
        i.rm_name,
        i.department,
        i.ledger_balance  -- Added for opening balance fallback
      FROM investors i
    ),
    
    -- Calculate snapshots
    snapshots AS (
      SELECT 
        u.investor_code,
        im.investor_name,
        im.account_type,
        im.interest_rate,
        im.brokerage_commission AS brokerage_rate,
        im.rm_id,
        im.rm_name,
        im.department,
        -- UPDATED: Opening balance fallback chain - most recent snapshot → investors.ledger_balance → 0
        COALESCE(pb.closing_balance, im.ledger_balance, 0) AS opening_balance,
        COALESCE(dd.deposits, 0) AS total_deposits,
        COALESCE(dd.withdrawals, 0) AS total_withdrawals,
        COALESCE(dd.ledger_snapshot, 0) AS ledger_balance_snapshot,
        COALESCE(dt.gross_buy, 0) AS gross_buy,
        COALESCE(dt.gross_sell, 0) AS gross_sell,
        COALESCE(dt.total_commission, 0) AS total_commission,
        -- Closing balance formula using new opening_balance
        COALESCE(pb.closing_balance, im.ledger_balance, 0) 
          + COALESCE(dd.deposits, 0) 
          - COALESCE(dd.withdrawals, 0) 
          + COALESCE(dt.gross_sell, 0) 
          - COALESCE(dt.gross_buy, 0) 
          - COALESCE(dt.total_commission, 0) AS closing_balance,
        -- Net trade value
        COALESCE(dt.gross_sell, 0) - COALESCE(dt.gross_buy, 0) AS net_trade_value,
        -- Previous cumulative interest
        COALESCE(pb.cumulative_interest, 0) AS prev_cumulative_interest
      FROM universe u
      LEFT JOIN prev_balances pb ON pb.investor_code = u.investor_code
      LEFT JOIN daily_deposits dd ON dd.investor_code = u.investor_code
      LEFT JOIN daily_trades dt ON dt.investor_code = u.investor_code
      LEFT JOIN investor_meta im ON im.investor_code = u.investor_code
    ),
    
    -- Calculate accrued interest for margin accounts
    with_interest AS (
      SELECT 
        s.*,
        -- Calculate daily accrued interest for negative balances
        CASE 
          WHEN s.closing_balance < 0 AND COALESCE(s.interest_rate, 0) > 0 THEN
            (COALESCE(s.interest_rate, 0) / 365.0 / 100.0) * ABS(s.closing_balance)
          ELSE 0
        END AS accrued_interest,
        -- Cumulative interest
        s.prev_cumulative_interest + 
        CASE 
          WHEN s.closing_balance < 0 AND COALESCE(s.interest_rate, 0) > 0 THEN
            (COALESCE(s.interest_rate, 0) / 365.0 / 100.0) * ABS(s.closing_balance)
          ELSE 0
        END AS cumulative_interest
      FROM snapshots s
    ),
    
    -- Insert/update snapshots
    upserted AS (
      INSERT INTO eod_ledger_snapshots (
        investor_code,
        investor_name,
        eod_date,
        opening_balance,
        closing_balance,
        ledger_balance,
        total_deposits,
        total_withdrawals,
        gross_buy,
        gross_sell,
        total_commission,
        net_trade_value,
        accrued_interest,
        cumulative_interest,
        interest_rate,
        brokerage_rate,
        account_type,
        rm_id,
        rm_name,
        department,
        ledger_balance_snapshot,
        created_by
      )
      SELECT 
        wi.investor_code,
        wi.investor_name,
        p_eod_date,
        wi.opening_balance,
        wi.closing_balance,
        wi.closing_balance, -- ledger_balance = closing_balance
        wi.total_deposits,
        wi.total_withdrawals,
        wi.gross_buy,
        wi.gross_sell,
        wi.total_commission,
        wi.net_trade_value,
        wi.accrued_interest,
        wi.cumulative_interest,
        wi.interest_rate,
        wi.brokerage_rate,
        wi.account_type,
        wi.rm_id,
        wi.rm_name,
        wi.department,
        wi.ledger_balance_snapshot,
        auth.uid()
      FROM with_interest wi
      WHERE NOT (p_skip_existing AND EXISTS (
        SELECT 1 FROM eod_ledger_snapshots es 
        WHERE es.investor_code = wi.investor_code AND es.eod_date = p_eod_date
      ))
      ON CONFLICT (investor_code, eod_date) 
      DO UPDATE SET
        investor_name = EXCLUDED.investor_name,
        opening_balance = EXCLUDED.opening_balance,
        closing_balance = EXCLUDED.closing_balance,
        ledger_balance = EXCLUDED.ledger_balance,
        total_deposits = EXCLUDED.total_deposits,
        total_withdrawals = EXCLUDED.total_withdrawals,
        gross_buy = EXCLUDED.gross_buy,
        gross_sell = EXCLUDED.gross_sell,
        total_commission = EXCLUDED.total_commission,
        net_trade_value = EXCLUDED.net_trade_value,
        accrued_interest = EXCLUDED.accrued_interest,
        cumulative_interest = EXCLUDED.cumulative_interest,
        interest_rate = EXCLUDED.interest_rate,
        brokerage_rate = EXCLUDED.brokerage_rate,
        account_type = EXCLUDED.account_type,
        rm_id = EXCLUDED.rm_id,
        rm_name = EXCLUDED.rm_name,
        department = EXCLUDED.department,
        ledger_balance_snapshot = EXCLUDED.ledger_balance_snapshot,
        created_by = EXCLUDED.created_by
      RETURNING investor_code, closing_balance, total_deposits, total_withdrawals, gross_buy, gross_sell, total_commission
    )
    -- Get summary statistics
    SELECT 
      COUNT(*),
      COALESCE(SUM(closing_balance), 0),
      COALESCE(SUM(total_deposits), 0),
      COALESCE(SUM(total_withdrawals), 0),
      COALESCE(SUM(gross_buy), 0),
      COALESCE(SUM(gross_sell), 0),
      COALESCE(SUM(total_commission), 0)
    INTO 
      v_clients_captured,
      v_total_ledger_balance,
      v_total_deposits,
      v_total_withdrawals,
      v_gross_buy,
      v_gross_sell,
      v_total_commission
    FROM upserted;

    -- Snapshot holdings
    DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
    
    INSERT INTO eod_holding_snapshots (
      investor_code,
      security_code,
      eod_date,
      total_qty,
      total_qty_saleable,
      avg_cost,
      total_cost,
      market_value
    )
    SELECT 
      h.investor_code,
      h.trading_code,
      p_eod_date,
      COALESCE(h.total_stock, 0),
      COALESCE(h.saleable, 0),
      COALESCE(h.avg_cost, 0),
      COALESCE(h.total_cost, 0),
      COALESCE(h.market_value, 0)
    FROM holdings h
    WHERE h.investor_code IN (SELECT investor_code FROM universe);

    -- Record run history
    INSERT INTO eod_run_history (
      run_date,
      run_by,
      run_by_email,
      clients_captured,
      total_ledger_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      trade_files_count,
      deposit_records_count,
      status
    ) VALUES (
      p_eod_date,
      auth.uid(),
      v_user_email,
      v_clients_captured,
      v_total_ledger_balance,
      v_total_deposits,
      v_total_withdrawals,
      v_gross_buy,
      v_gross_sell,
      v_total_commission,
      v_trade_files_count,
      v_deposit_records_count,
      'completed'
    );

    RETURN jsonb_build_object(
      'success', true,
      'clients_captured', v_clients_captured,
      'total_ledger_balance', v_total_ledger_balance,
      'total_deposits', v_total_deposits,
      'total_withdrawals', v_total_withdrawals,
      'gross_buy', v_gross_buy,
      'gross_sell', v_gross_sell,
      'total_commission', v_total_commission,
      'trade_files_count', v_trade_files_count,
      'deposit_records_count', v_deposit_records_count
    );

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS 
      v_error_message = MESSAGE_TEXT,
      v_error_detail = PG_EXCEPTION_DETAIL,
      v_error_hint = PG_EXCEPTION_HINT,
      v_error_context = PG_EXCEPTION_CONTEXT;
    
    -- Log failed run
    INSERT INTO eod_run_history (
      run_date, run_by, run_by_email, clients_captured, total_ledger_balance, status, notes
    ) VALUES (
      p_eod_date, auth.uid(), v_user_email, 0, 0, 'failed',
      'Error: ' || v_error_message || ' | Detail: ' || COALESCE(v_error_detail, 'none') || ' | Context: ' || COALESCE(v_error_context, 'none')
    );
    
    RETURN jsonb_build_object(
      'success', false,
      'error', v_error_message,
      'detail', v_error_detail,
      'hint', v_error_hint,
      'clients_captured', 0
    );
  END;
END;
$$;