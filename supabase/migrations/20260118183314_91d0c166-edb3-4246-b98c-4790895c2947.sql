-- Update run_batch_eod to apply commission and filter executed trades
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date DATE, p_skip_existing BOOLEAN DEFAULT TRUE)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_existing_count INTEGER;
  v_trade_date_str TEXT;
BEGIN
  -- Convert date to YYYYMMDD format for trade_history comparison
  v_trade_date_str := TO_CHAR(p_eod_date, 'YYYYMMDD');
  
  -- Check if EOD already exists for this date
  SELECT COUNT(*) INTO v_existing_count 
  FROM eod_run_history 
  WHERE run_date = p_eod_date;
  
  -- If skip_existing is true and EOD exists, return early
  IF p_skip_existing AND v_existing_count > 0 THEN
    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for ' || p_eod_date::text
    );
  END IF;
  
  -- If re-running, delete existing data (both snapshots AND run history)
  IF v_existing_count > 0 THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;
  
  -- Calculate and insert EOD snapshots for each investor
  -- Uses previous day's EOD snapshot as base, then adds today's trades and deposits
  -- Commission is applied: if brokerage_commission >= 0.1, treat as percent and divide by 100
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
  SELECT 
    p_eod_date,
    i.investor_code,
    i.investor_name,
    -- Base balance: previous day's EOD snapshot (cumulative), or 0 if none
    COALESCE(prev_eod.ledger_balance, 0) 
    -- Add today's deposits (positive) and withdrawals (negative)
    + COALESCE(dw.deposit_balance, 0) 
    -- Add today's trades with commission applied
    + COALESCE(th.trade_balance, 0) as ledger_balance,
    COALESCE(prev_eod.rm_email, i.trader) as rm_email
  FROM investors i
  -- Get previous day's EOD balance (the most recent EOD before p_eod_date)
  LEFT JOIN LATERAL (
    SELECT ledger_balance, rm_email
    FROM eod_ledger_snapshots
    WHERE investor_code = i.investor_code
    AND eod_date < p_eod_date
    ORDER BY eod_date DESC
    LIMIT 1
  ) prev_eod ON true
  -- Get today's deposits/withdrawals
  LEFT JOIN (
    SELECT investor_code,
           SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE -amount END) as deposit_balance
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ) dw ON dw.investor_code = i.investor_code
  -- Get today's trades with commission applied (only executed trades: FILL, PF)
  LEFT JOIN (
    SELECT client_code,
           SUM(
             CASE 
               WHEN side = 'Sell' THEN 
                 -- Sell: client receives value minus commission
                 value * (1 - (CASE WHEN COALESCE(brokerage_commission, 0) >= 0.1 THEN brokerage_commission / 100.0 ELSE brokerage_commission END))
               ELSE 
                 -- Buy: client pays value plus commission (negative impact)
                 -value * (1 + (CASE WHEN COALESCE(brokerage_commission, 0) >= 0.1 THEN brokerage_commission / 100.0 ELSE brokerage_commission END))
             END
           ) as trade_balance
    FROM trade_history
    WHERE trade_date = v_trade_date_str
      AND COALESCE(value, 0) != 0
      AND COALESCE(fill_type, status) IN ('FILL', 'PF')
    GROUP BY client_code
  ) th ON th.client_code = i.investor_code;
  
  GET DIAGNOSTICS v_clients_captured = ROW_COUNT;
  
  -- Calculate totals
  SELECT 
    COALESCE(SUM(ledger_balance), 0),
    COALESCE(SUM(CASE WHEN ledger_balance > 0 THEN ledger_balance ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ledger_balance < 0 THEN ABS(ledger_balance) ELSE 0 END), 0)
  INTO v_total_ledger, v_total_deposits, v_total_withdrawals
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;
  
  -- Record the run
  INSERT INTO eod_run_history (run_date, clients_captured, total_ledger_balance, total_deposits, total_withdrawals, status)
  VALUES (p_eod_date, v_clients_captured, v_total_ledger, v_total_deposits, v_total_withdrawals, 'completed');
  
  RETURN json_build_object(
    'success', true,
    'skipped', false,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'eod_date', p_eod_date
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;