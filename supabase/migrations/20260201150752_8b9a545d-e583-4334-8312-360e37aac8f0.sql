-- Fix run_batch_eod to use type column for deposit/withdrawal classification
-- The cash_ledger_txn table stores ALL amounts as positive values
-- The type column ('DEPOSIT' or 'WITHDRAW') determines the transaction type

CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date DATE,
  p_skip_existing BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_user_email TEXT;
  v_existing_run_id UUID;
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
      'message', 'EOD already exists for this date',
      'eod_date', p_eod_date
    );
  END IF;

  -- If re-running, clear existing data
  IF v_existing_run_id IS NOT NULL THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Get current user email
  v_user_email := COALESCE(
    auth.jwt() ->> 'email',
    current_user
  );

  -- Calculate trade totals
  SELECT 
    COUNT(DISTINCT exchange_code),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(commission), 0)
  INTO v_trade_files_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM trade_file
  WHERE trade_date = p_eod_date;

  -- Calculate deposit/withdrawal totals using TYPE column (not amount sign)
  -- All amounts in cash_ledger_txn are stored as POSITIVE values
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(type) = 'WITHDRAW' THEN amount ELSE 0 END), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Count deposit records
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date;

  -- Insert ledger snapshots with trade and cash flow data
  WITH 
  -- Get previous day's closing balances
  prev_day AS MATERIALIZED (
    SELECT investor_code, closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = (
      SELECT MAX(eod_date) FROM eod_ledger_snapshots WHERE eod_date < p_eod_date
    )
  ),
  -- Get today's trades aggregated by investor
  today_trades AS MATERIALIZED (
    SELECT
      tf.investor_code,
      COALESCE(SUM(CASE WHEN UPPER(tf.side) = 'BUY' THEN tf.qty * tf.price ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(tf.side) = 'SELL' THEN tf.qty * tf.price ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(tf.commission), 0) as total_commission
    FROM trade_file tf
    WHERE tf.trade_date = p_eod_date
    GROUP BY tf.investor_code
  ),
  -- Get today's deposits and withdrawals using TYPE column (not amount sign)
  today_cash AS MATERIALIZED (
    SELECT
      investor_code,
      COALESCE(SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN UPPER(type) = 'WITHDRAW' THEN amount ELSE 0 END), 0) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Base investor data
  base_investors AS MATERIALIZED (
    SELECT 
      i.investor_code,
      i.investor_name,
      i.account_type,
      i.brokerage_commission,
      i.interest_rate,
      i.department,
      ira.rm_email,
      ira.rm_name
    FROM investors i
    LEFT JOIN investor_rm_assignments ira ON i.investor_code = ira.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    account_type,
    brokerage_rate,
    interest_rate,
    department,
    rm_email,
    rm_name,
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
    p_eod_date,
    bi.investor_code,
    bi.investor_name,
    bi.account_type,
    bi.brokerage_commission,
    bi.interest_rate,
    bi.department,
    bi.rm_email,
    bi.rm_name,
    COALESCE(pd.closing_balance, 0) as opening_balance,
    COALESCE(tt.gross_buy, 0) as gross_buy,
    COALESCE(tt.gross_sell, 0) as gross_sell,
    COALESCE(tt.total_commission, 0) as total_commission,
    COALESCE(tc.deposits, 0) as total_deposits,
    COALESCE(tc.withdrawals, 0) as total_withdrawals,
    -- Calculate closing balance: opening + sells - buys - commission + deposits - withdrawals
    COALESCE(pd.closing_balance, 0) 
      + COALESCE(tt.gross_sell, 0) 
      - COALESCE(tt.gross_buy, 0) 
      - COALESCE(tt.total_commission, 0)
      + COALESCE(tc.deposits, 0) 
      - COALESCE(tc.withdrawals, 0) as closing_balance,
    COALESCE(pd.closing_balance, 0) 
      + COALESCE(tt.gross_sell, 0) 
      - COALESCE(tt.gross_buy, 0) 
      - COALESCE(tt.total_commission, 0)
      + COALESCE(tc.deposits, 0) 
      - COALESCE(tc.withdrawals, 0) as ledger_balance,
    v_user_email
  FROM base_investors bi
  LEFT JOIN prev_day pd ON bi.investor_code = pd.investor_code
  LEFT JOIN today_trades tt ON bi.investor_code = tt.investor_code
  LEFT JOIN today_cash tc ON bi.investor_code = tc.investor_code;

  -- Get count of inserted snapshots
  GET DIAGNOSTICS v_clients_captured = ROW_COUNT;

  -- Calculate total ledger balance
  SELECT COALESCE(SUM(closing_balance), 0)
  INTO v_total_ledger_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Insert run history record
  INSERT INTO eod_run_history (
    run_date,
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
    v_user_email,
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