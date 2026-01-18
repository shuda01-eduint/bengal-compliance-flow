-- First drop the existing function, then recreate with fixed trade date format
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

-- Fix trade date format mismatch in run_batch_eod function
-- The trade_history table stores dates as 'YYYYMMDD' format (e.g., '20260113')
-- but the function was comparing with 'YYYY-MM-DD' format (e.g., '2026-01-13')

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured int := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_deposit_records int := 0;
  v_trade_files int := 0;
  v_run_id uuid;
  v_prev_date date;
  v_trade_date_str text;
BEGIN
  -- Convert date to YYYYMMDD format for trade_history comparison
  v_trade_date_str := TO_CHAR(p_eod_date, 'YYYYMMDD');
  
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'message', 'EOD already completed for ' || p_eod_date::text
    );
  END IF;

  -- Find previous EOD date
  SELECT MAX(run_date) INTO v_prev_date
  FROM eod_run_history
  WHERE run_date < p_eod_date AND status = 'completed';

  -- Delete any existing incomplete runs or snapshots for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Create run history record
  INSERT INTO eod_run_history (run_date, status, clients_captured, total_ledger_balance)
  VALUES (p_eod_date, 'running', 0, 0)
  RETURNING id INTO v_run_id;

  -- Count trade files for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files
  FROM trade_history
  WHERE trade_date = v_trade_date_str;

  -- Calculate and insert EOD snapshots
  WITH 
  -- Get previous day balances
  prev_balances AS (
    SELECT investor_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  -- Get opening balances for investors without previous EOD
  opening_balances AS (
    SELECT 
      i.investor_code,
      COALESCE(c.ledger_balance, 0) as opening_balance
    FROM investors i
    LEFT JOIN clients c ON c.inv_code = i.investor_code
  ),
  -- Get deposits/withdrawals for this date
  transactions AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date::text
    GROUP BY investor_code
  ),
  -- Get trades for this date with commission calculation
  trades AS (
    SELECT 
      th.client_code as investor_code,
      SUM(CASE WHEN th.side = 'SELL' THEN th.value ELSE 0 END) as gross_sell,
      SUM(CASE WHEN th.side = 'BUY' THEN th.value ELSE 0 END) as gross_buy,
      SUM(CASE 
        WHEN th.side = 'SELL' THEN 
          th.value - (th.value * COALESCE(
            CASE WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100 
                 ELSE COALESCE(i.brokerage_commission, 0.004) END,
            0.004
          ))
        WHEN th.side = 'BUY' THEN 
          -(th.value + (th.value * COALESCE(
            CASE WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100 
                 ELSE COALESCE(i.brokerage_commission, 0.004) END,
            0.004
          )))
        ELSE 0 
      END) as net_trade_impact
    FROM trade_history th
    LEFT JOIN investors i ON i.investor_code = th.client_code
    WHERE th.trade_date = v_trade_date_str
      AND th.status IN ('FILL', 'PF')
    GROUP BY th.client_code
  ),
  -- Combine all data
  combined AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(pb.ledger_balance, ob.opening_balance, 0) as opening_balance,
      COALESCE(t.deposits, 0) as deposits,
      COALESCE(t.withdrawals, 0) as withdrawals,
      COALESCE(tr.net_trade_impact, 0) as net_trade_impact,
      COALESCE(tr.gross_buy, 0) as gross_buy,
      COALESCE(tr.gross_sell, 0) as gross_sell
    FROM investors i
    LEFT JOIN prev_balances pb ON pb.investor_code = i.investor_code
    LEFT JOIN opening_balances ob ON ob.investor_code = i.investor_code
    LEFT JOIN transactions t ON t.investor_code = i.investor_code
    LEFT JOIN trades tr ON tr.investor_code = i.investor_code
    WHERE pb.investor_code IS NOT NULL 
       OR t.investor_code IS NOT NULL 
       OR tr.investor_code IS NOT NULL
       OR (v_prev_date IS NULL AND ob.opening_balance != 0)
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    ledger_balance,
    rm_email
  )
  SELECT 
    p_eod_date,
    c.investor_code,
    c.investor_name,
    c.opening_balance + c.deposits - c.withdrawals + c.net_trade_impact,
    (SELECT rm_email FROM investor_rm_assignments WHERE investor_code = c.investor_code LIMIT 1)
  FROM combined c;

  -- Get counts and totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Get deposit/withdrawal totals
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_total_deposits, v_total_withdrawals, v_deposit_records
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date::text;

  -- Update run history
  UPDATE eod_run_history
  SET 
    status = 'completed',
    clients_captured = v_clients_captured,
    total_ledger_balance = v_total_ledger,
    total_deposits = v_total_deposits,
    total_withdrawals = v_total_withdrawals,
    deposit_records_count = v_deposit_records,
    trade_files_count = v_trade_files
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'deposit_records', v_deposit_records,
    'trade_files', v_trade_files
  );

EXCEPTION WHEN OTHERS THEN
  -- Update run history with error
  UPDATE eod_run_history
  SET status = 'failed', notes = SQLERRM
  WHERE id = v_run_id;
  
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;