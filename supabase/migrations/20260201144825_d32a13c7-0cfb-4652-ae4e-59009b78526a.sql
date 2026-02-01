-- Update run_batch_eod to calculate commission from investor rates instead of reading zeroed values from trade_file
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_ledger_balance numeric := 0;
  v_trade_files_count integer := 0;
  v_deposit_records_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_existing_run_id uuid;
  v_run_id uuid;
  v_user_email text;
BEGIN
  -- Check if EOD already exists for this date
  SELECT id INTO v_existing_run_id
  FROM eod_run_history
  WHERE run_date = p_eod_date
  LIMIT 1;

  IF v_existing_run_id IS NOT NULL AND p_skip_existing THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD already exists for %s', p_eod_date),
      'eod_date', p_eod_date
    );
  END IF;

  -- If not skipping, delete existing EOD data for this date
  IF v_existing_run_id IS NOT NULL THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Get current user email
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Count trade files from trade_file table (using distinct exchange_code as proxy)
  SELECT COUNT(DISTINCT exchange_code) INTO v_trade_files_count
  FROM trade_file
  WHERE trade_date = p_eod_date;

  -- Count deposit/withdrawal records
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Calculate deposits and withdrawals totals
  SELECT 
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Insert EOD snapshots using CTEs for efficiency
  WITH prev_day_balance AS MATERIALIZED (
    SELECT 
      investor_code,
      closing_balance as opening_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - INTERVAL '1 day'
  ),
  today_trades AS MATERIALIZED (
    SELECT
      tf.investor_code,
      SUM(CASE WHEN UPPER(tf.side) = 'SELL' THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) as gross_sell,
      SUM(CASE WHEN UPPER(tf.side) = 'BUY' THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) as gross_buy,
      -- Calculate commission from investor's brokerage_commission rate
      SUM(
        COALESCE(tf.qty * tf.price, 0) *
        CASE
          WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
          WHEN i.brokerage_commission < 0.1 AND i.brokerage_commission > 0 THEN i.brokerage_commission
          ELSE 0.004
        END
      ) as total_commission
    FROM trade_file tf
    LEFT JOIN investors i ON tf.investor_code = i.investor_code
    WHERE tf.trade_date = p_eod_date
      AND tf.investor_code IS NOT NULL
    GROUP BY tf.investor_code
  ),
  today_cash AS MATERIALIZED (
    SELECT
      investor_code,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_eod_date
    GROUP BY investor_code
  ),
  all_investors AS (
    SELECT investor_code, investor_name, rm_id, rm_name, department,
           brokerage_commission, account_type
    FROM investors
    WHERE status = 'Active' OR investor_code IN (
      SELECT DISTINCT investor_code FROM today_trades
      UNION
      SELECT DISTINCT investor_code FROM today_cash
    )
  ),
  snapshot_data AS (
    SELECT
      p_eod_date as eod_date,
      ai.investor_code,
      ai.investor_name,
      ai.rm_id,
      ai.rm_name,
      ai.department,
      ai.account_type,
      ai.brokerage_commission as brokerage_rate,
      COALESCE(pb.opening_balance, 0) as opening_balance,
      COALESCE(tt.gross_buy, 0) as gross_buy,
      COALESCE(tt.gross_sell, 0) as gross_sell,
      COALESCE(tt.total_commission, 0) as total_commission,
      COALESCE(tc.deposits, 0) as total_deposits,
      COALESCE(tc.withdrawals, 0) as total_withdrawals,
      -- Calculate closing balance
      COALESCE(pb.opening_balance, 0) 
        + COALESCE(tt.gross_sell, 0) 
        - COALESCE(tt.gross_buy, 0)
        - COALESCE(tt.total_commission, 0)
        + COALESCE(tc.deposits, 0) 
        - COALESCE(tc.withdrawals, 0) as closing_balance
    FROM all_investors ai
    LEFT JOIN prev_day_balance pb ON ai.investor_code = pb.investor_code
    LEFT JOIN today_trades tt ON ai.investor_code = tt.investor_code
    LEFT JOIN today_cash tc ON ai.investor_code = tc.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_id,
    rm_name,
    department,
    account_type,
    brokerage_rate,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    closing_balance,
    ledger_balance,
    created_by
  )
  SELECT
    eod_date,
    investor_code,
    investor_name,
    rm_id,
    rm_name,
    department,
    account_type,
    brokerage_rate,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    closing_balance,
    closing_balance as ledger_balance,
    auth.uid()
  FROM snapshot_data;

  GET DIAGNOSTICS v_clients_captured = ROW_COUNT;

  -- Calculate summary totals from inserted snapshots
  SELECT 
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO v_total_ledger_balance, v_gross_buy, v_gross_sell, v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Insert run history record
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
    auth.uid(),
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
  )
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
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