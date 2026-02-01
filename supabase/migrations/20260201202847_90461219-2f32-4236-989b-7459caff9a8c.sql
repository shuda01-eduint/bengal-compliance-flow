-- Fix run_batch_eod RETURNING clause to use correct column names (total_deposits, total_withdrawals)
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured integer;
  v_total_ledger_balance numeric;
  v_trade_files_count integer;
  v_deposit_records_count integer;
  v_gross_buy numeric;
  v_gross_sell numeric;
  v_total_commission numeric;
  v_total_deposits numeric;
  v_total_withdrawals numeric;
  v_existing_run_id uuid;
BEGIN
  -- Check if EOD already exists for this date
  SELECT id INTO v_existing_run_id
  FROM eod_run_history
  WHERE run_date = p_eod_date
  LIMIT 1;

  IF v_existing_run_id IS NOT NULL THEN
    IF p_skip_existing THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', 'EOD already exists for ' || p_eod_date::text
      );
    ELSE
      -- Clear existing EOD data for re-run
      DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
      DELETE FROM eod_run_history WHERE run_date = p_eod_date;
    END IF;
  END IF;

  -- Get trade file count
  SELECT COUNT(*) INTO v_trade_files_count
  FROM trade_file
  WHERE trade_date = p_eod_date;

  -- Get deposit/withdrawal count
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Main EOD calculation with CTEs
  WITH 
  -- Get previous day's closing balances
  prev_day AS (
    SELECT investor_code, closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = (
      SELECT MAX(eod_date) FROM eod_ledger_snapshots WHERE eod_date < p_eod_date
    )
  ),
  -- Get baseline balances from eod_investor_balance
  baseline AS (
    SELECT investor_code, closing_ledger_balance, rm_id
    FROM eod_investor_balance
    WHERE trade_date = (
      SELECT MAX(trade_date) FROM eod_investor_balance WHERE trade_date <= p_eod_date
    )
  ),
  -- Aggregate trades for the day
  trade_agg AS (
    SELECT 
      tf.investor_code,
      SUM(CASE WHEN UPPER(tf.side) IN ('B', 'BUY') THEN tf.qty * tf.price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(tf.side) IN ('S', 'SELL') THEN tf.qty * tf.price ELSE 0 END) as gross_sell,
      SUM(COALESCE(tf.commission, 0)) as total_commission
    FROM trade_file tf
    WHERE tf.trade_date = p_eod_date
    GROUP BY tf.investor_code
  ),
  -- Aggregate deposits/withdrawals for the day
  cash_agg AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(type) IN ('WITHDRAW', 'WITHDRAWAL') THEN amount ELSE 0 END) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Get all investors who have activity or baseline
  all_investors AS (
    SELECT DISTINCT investor_code FROM trade_agg
    UNION
    SELECT DISTINCT investor_code FROM cash_agg
    UNION
    SELECT DISTINCT investor_code FROM baseline
    UNION
    SELECT DISTINCT investor_code FROM prev_day
  ),
  -- Calculate opening balance (previous closing or baseline)
  with_opening AS (
    SELECT 
      ai.investor_code,
      COALESCE(pd.closing_balance, bl.closing_ledger_balance, 0) as opening_balance,
      bl.rm_id
    FROM all_investors ai
    LEFT JOIN prev_day pd ON pd.investor_code = ai.investor_code
    LEFT JOIN baseline bl ON bl.investor_code = ai.investor_code
  ),
  -- Calculate closing balance
  with_closing AS (
    SELECT 
      wo.investor_code,
      wo.opening_balance,
      wo.rm_id,
      COALESCE(ta.gross_buy, 0) as gross_buy,
      COALESCE(ta.gross_sell, 0) as gross_sell,
      COALESCE(ta.total_commission, 0) as total_commission,
      COALESCE(ca.deposits, 0) as deposits,
      COALESCE(ca.withdrawals, 0) as withdrawals,
      wo.opening_balance 
        + COALESCE(ta.gross_sell, 0) 
        - COALESCE(ta.gross_buy, 0) 
        - COALESCE(ta.total_commission, 0)
        + COALESCE(ca.deposits, 0)
        - COALESCE(ca.withdrawals, 0) as closing_balance
    FROM with_opening wo
    LEFT JOIN trade_agg ta ON ta.investor_code = wo.investor_code
    LEFT JOIN cash_agg ca ON ca.investor_code = wo.investor_code
  ),
  -- Get investor details
  with_details AS (
    SELECT 
      wc.*,
      inv.investor_name,
      inv.interest_rate,
      inv.account_type,
      inv.department,
      COALESCE(ira.rm_email, inv.rm_id) as rm_email,
      COALESCE(ira.rm_name, inv.rm_name) as rm_name
    FROM with_closing wc
    LEFT JOIN investors inv ON inv.investor_code = wc.investor_code
    LEFT JOIN investor_rm_assignments ira ON ira.investor_code = wc.investor_code
  ),
  -- Calculate daily interest for margin accounts
  with_interest AS (
    SELECT 
      wd.*,
      CASE 
        WHEN wd.closing_balance < 0 AND COALESCE(wd.interest_rate, 0) > 0 
        THEN ABS(wd.closing_balance) * (wd.interest_rate / 100 / 365)
        ELSE 0 
      END as daily_interest
    FROM with_details wd
  ),
  -- Insert snapshots and return aggregates
  inserted AS (
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
      interest_rate,
      accrued_interest,
      account_type,
      department,
      rm_id,
      rm_email,
      rm_name,
      created_by
    )
    SELECT 
      p_eod_date,
      wi.investor_code,
      wi.investor_name,
      wi.opening_balance,
      wi.closing_balance,
      wi.closing_balance,
      wi.gross_buy,
      wi.gross_sell,
      wi.total_commission,
      wi.deposits,
      wi.withdrawals,
      wi.interest_rate,
      wi.daily_interest,
      wi.account_type,
      wi.department,
      wi.rm_id,
      wi.rm_email,
      wi.rm_name,
      auth.uid()
    FROM with_interest wi
    RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission, total_deposits, total_withdrawals
  )
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0)
  INTO 
    v_clients_captured,
    v_total_ledger_balance,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals
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
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    status
  ) VALUES (
    p_eod_date,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
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