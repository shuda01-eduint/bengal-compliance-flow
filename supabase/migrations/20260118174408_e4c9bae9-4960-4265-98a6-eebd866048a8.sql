-- Add indexes for better EOD performance
CREATE INDEX IF NOT EXISTS idx_trade_history_trade_date ON trade_history(trade_date);
CREATE INDEX IF NOT EXISTS idx_trade_history_client_code ON trade_history(client_code);
CREATE INDEX IF NOT EXISTS idx_eod_ledger_snapshots_eod_date ON eod_ledger_snapshots(eod_date);
CREATE INDEX IF NOT EXISTS idx_eod_ledger_snapshots_investor_code ON eod_ledger_snapshots(investor_code);
CREATE INDEX IF NOT EXISTS idx_deposits_withdrawals_date ON deposits_withdrawals(transaction_date);
CREATE INDEX IF NOT EXISTS idx_deposits_withdrawals_investor ON deposits_withdrawals(investor_code);

-- Optimized run_batch_eod function with extended timeout and batch processing
CREATE OR REPLACE FUNCTION run_batch_eod(
  p_eod_date DATE,
  p_skip_existing BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_result JSON;
  v_clients_captured INT := 0;
  v_total_ledger NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_trade_date_str TEXT;
  v_existing_count INT;
  v_run_id UUID;
BEGIN
  -- Check if EOD already exists for this date
  SELECT COUNT(*) INTO v_existing_count
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;
  
  IF v_existing_count > 0 AND p_skip_existing THEN
    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists with %s snapshots', p_eod_date, v_existing_count),
      'clients_captured', v_existing_count
    );
  END IF;
  
  -- Delete existing snapshots for this date if re-running
  IF v_existing_count > 0 THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  END IF;
  
  -- Convert date to trade_date format (YYYYMMDD)
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  
  -- Insert EOD snapshots using efficient batch insert
  -- Get unique clients from investors table and calculate their balances
  WITH client_balances AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(
        (SELECT SUM(CASE WHEN d.transaction_type = 'Deposit' THEN d.amount ELSE -d.amount END)
         FROM deposits_withdrawals d
         WHERE d.investor_code = i.investor_code
           AND d.transaction_date <= p_eod_date),
        0
      ) as deposit_balance,
      COALESCE(
        (SELECT SUM(CASE 
           WHEN t.side = 'B' THEN -COALESCE(t.value, 0)
           WHEN t.side = 'S' THEN COALESCE(t.value, 0)
           ELSE 0
         END)
         FROM trade_history t
         WHERE t.client_code = i.investor_code
           AND t.trade_date <= v_trade_date_str
           AND t.status = 'Executed'),
        0
      ) as trade_balance
    FROM investors i
    WHERE i.status = 'Active' OR i.status IS NULL
  ),
  inserted AS (
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      ledger_balance,
      created_at
    )
    SELECT 
      p_eod_date,
      cb.investor_code,
      cb.investor_name,
      cb.deposit_balance + cb.trade_balance,
      NOW()
    FROM client_balances cb
    RETURNING ledger_balance
  )
  SELECT 
    COUNT(*),
    COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger
  FROM inserted;
  
  -- Get deposit/withdrawal totals for the date
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;
  
  -- Record the run in history
  INSERT INTO eod_run_history (
    run_date,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    status,
    run_at
  ) VALUES (
    p_eod_date,
    v_clients_captured,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    'completed',
    NOW()
  )
  RETURNING id INTO v_run_id;
  
  RETURN json_build_object(
    'success', true,
    'skipped', false,
    'run_id', v_run_id,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'eod_date', p_eod_date
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'eod_date', p_eod_date
  );
END;
$$;