-- Fix type mismatch: trade_date (TEXT) vs p_eod_date (DATE)
-- Convert p_eod_date to YYYYMMDD text format for all trade_history comparisons

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $function$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_existing_run_id uuid;
  v_run_id uuid;
  v_clients_count integer := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_eod_date_text TEXT := TO_CHAR(p_eod_date, 'YYYYMMDD');
BEGIN
  -- Authorization check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT public.has_role(v_user_id, 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can run batch EOD');
  END IF;

  -- Get user email
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Check for existing run
  SELECT id INTO v_existing_run_id FROM eod_run_history WHERE run_date = p_eod_date LIMIT 1;
  
  IF v_existing_run_id IS NOT NULL AND p_skip_existing THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for ' || p_eod_date::text
    );
  END IF;

  -- Delete existing data for this date (re-run scenario)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Count trade files for this date (use text format)
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_eod_date_text;

  -- Count deposit records for this date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Build universe: all investors with trades, deposits, previous balances, or master data
  WITH universe AS (
    -- Investors with trades on this date
    SELECT DISTINCT client_code AS investor_code
    FROM trade_history
    WHERE trade_date = v_eod_date_text
      AND client_code IS NOT NULL
    UNION
    -- Investors with deposits/withdrawals on this date
    SELECT DISTINCT investor_code
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    UNION
    -- Investors with previous day balance
    SELECT DISTINCT investor_code
    FROM eod_ledger_snapshots
    WHERE eod_date = (p_eod_date - INTERVAL '1 day')::date
    UNION
    -- All investors in master data
    SELECT DISTINCT investor_code FROM investors
  ),
  -- Get previous day closing balance
  prev_balance AS (
    SELECT 
      investor_code,
      closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = (p_eod_date - INTERVAL '1 day')::date
  ),
  -- Daily deposits/withdrawals from deposits_withdrawals table
  daily_deposits_dw AS (
    SELECT 
      investor_code,
      COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Daily deposits from trade_history (use text format)
  daily_deposits_th AS (
    SELECT 
      client_code AS investor_code,
      COALESCE(MAX(total_deposits), 0) AS deposits,
      COALESCE(MAX(total_withdrawals), 0) AS withdrawals,
      MAX(ledger_balance_snapshot) AS ledger_snapshot
    FROM trade_history
    WHERE trade_date = v_eod_date_text
      AND client_code IS NOT NULL
    GROUP BY client_code
  ),
  -- Combine deposits sources (prefer deposits_withdrawals table, fallback to trade_history)
  daily_deposits AS (
    SELECT 
      COALESCE(dw.investor_code, th.investor_code) AS investor_code,
      COALESCE(dw.deposits, th.deposits, 0) AS deposits,
      COALESCE(dw.withdrawals, th.withdrawals, 0) AS withdrawals,
      th.ledger_snapshot
    FROM daily_deposits_dw dw
    FULL OUTER JOIN daily_deposits_th th ON dw.investor_code = th.investor_code
  ),
  -- Daily trades (use text format)
  daily_trades AS (
    SELECT 
      client_code AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(side) IN ('B', 'BUY') THEN COALESCE(value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(side) IN ('S', 'SELL') THEN COALESCE(value, 0) ELSE 0 END), 0) AS gross_sell,
      COALESCE(SUM(
        CASE 
          WHEN COALESCE(brokerage_commission, 0.3) >= 0.1 
          THEN COALESCE(value, 0) * COALESCE(brokerage_commission, 0.3) / 100
          ELSE COALESCE(value, 0) * COALESCE(brokerage_commission, 0.003)
        END
      ), 0) AS commission
    FROM trade_history
    WHERE trade_date = v_eod_date_text
      AND client_code IS NOT NULL
    GROUP BY client_code
  ),
  -- Investor metadata
  investor_meta AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.interest_rate,
      i.brokerage_commission,
      i.department,
      COALESCE(i.rm_id, ira.rm_id) AS rm_id,
      COALESCE(i.rm_name, ira.rm_name) AS rm_name,
      COALESCE(
        (SELECT e.email FROM employees e WHERE e.employee_id = i.rm_id LIMIT 1),
        ira.rm_email
      ) AS rm_email
    FROM investors i
    LEFT JOIN LATERAL (
      SELECT ira_sub.rm_email, ira_sub.rm_name, 
             (SELECT e.employee_id FROM employees e WHERE LOWER(e.email) = LOWER(ira_sub.rm_email) LIMIT 1) AS rm_id
      FROM investor_rm_assignments ira_sub
      WHERE ira_sub.investor_code = i.investor_code
      ORDER BY ira_sub.percentage DESC
      LIMIT 1
    ) ira ON true
  ),
  -- Calculate final snapshot
  snapshot_data AS (
    SELECT 
      u.investor_code,
      COALESCE(im.investor_name, u.investor_code) AS investor_name,
      im.account_type,
      im.interest_rate,
      im.brokerage_commission AS brokerage_rate,
      im.department,
      im.rm_id,
      im.rm_name,
      im.rm_email,
      COALESCE(pb.closing_balance, 0) AS opening_balance,
      COALESCE(dd.deposits, 0) AS deposits,
      COALESCE(dd.withdrawals, 0) AS withdrawals,
      COALESCE(dt.gross_buy, 0) AS gross_buy,
      COALESCE(dt.gross_sell, 0) AS gross_sell,
      COALESCE(dt.commission, 0) AS commission,
      dd.ledger_snapshot AS ledger_balance_snapshot,
      -- Calculate closing balance: opening + deposits - withdrawals + sells - buys - commission
      COALESCE(pb.closing_balance, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0) 
        + COALESCE(dt.gross_sell, 0) 
        - COALESCE(dt.gross_buy, 0) 
        - COALESCE(dt.commission, 0) AS closing_balance
    FROM universe u
    LEFT JOIN prev_balance pb ON pb.investor_code = u.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = u.investor_code
    LEFT JOIN daily_trades dt ON dt.investor_code = u.investor_code
    LEFT JOIN investor_meta im ON im.investor_code = u.investor_code
  )
  -- Insert snapshots
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    account_type,
    interest_rate,
    brokerage_rate,
    department,
    rm_id,
    rm_name,
    rm_email,
    opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    ledger_balance_snapshot,
    ledger_balance,
    closing_balance,
    created_by
  )
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    account_type,
    interest_rate,
    brokerage_rate,
    department,
    rm_id,
    rm_name,
    rm_email,
    opening_balance,
    deposits,
    withdrawals,
    gross_buy,
    gross_sell,
    commission,
    ledger_balance_snapshot,
    closing_balance,
    closing_balance,
    v_user_id
  FROM snapshot_data;

  GET DIAGNOSTICS v_clients_count = ROW_COUNT;

  -- Calculate totals
  SELECT 
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO v_total_ledger, v_total_deposits, v_total_withdrawals, v_gross_buy, v_gross_sell, v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Snapshot holdings
  INSERT INTO eod_holding_snapshots (
    eod_date,
    investor_code,
    security_code,
    total_qty,
    total_qty_saleable,
    avg_cost,
    total_cost,
    market_value
  )
  SELECT 
    p_eod_date,
    h.investor_code,
    h.trading_code,
    h.total_stock,
    h.saleable,
    h.avg_cost,
    h.total_cost,
    h.market_value
  FROM holdings h
  WHERE h.investor_code IN (SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = p_eod_date);

  -- Record run history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    status,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    trade_files_count,
    deposit_records_count
  ) VALUES (
    p_eod_date,
    v_user_id,
    v_user_email,
    'completed',
    v_clients_count,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_trade_files_count,
    v_deposit_records_count
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_count,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'eod_date', p_eod_date
  );
END;
$function$;