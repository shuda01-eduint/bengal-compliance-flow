-- Fix: Replace auth.users with public.profiles to avoid permission denied error
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SET statement_timeout = '600s'
AS $$
DECLARE
  v_clients_captured integer := 0;
  v_total_balance numeric := 0;
  v_prev_eod_date date;
  v_run_id uuid;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_deposit_count integer := 0;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM public.eod_run_history 
    WHERE run_date = p_eod_date AND status = 'completed'
  ) THEN
    RETURN json_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists, skipped', p_eod_date),
      'eod_date', p_eod_date
    );
  END IF;

  -- Delete existing EOD data for this date (for re-runs)
  DELETE FROM public.eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM public.eod_run_history WHERE run_date = p_eod_date;

  -- Find the most recent previous EOD date
  SELECT MAX(eod_date) INTO v_prev_eod_date
  FROM public.eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  -- Pre-aggregate deposits/withdrawals for the target date
  WITH day_deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM public.deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Pre-aggregate trades for the target date
  day_trades AS (
    SELECT 
      client_code,
      SUM(CASE WHEN side = 'B' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN side = 'S' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      SUM(COALESCE(brokerage_commission, 0)) as brokerage
    FROM public.trade_history
    WHERE trade_date = p_eod_date::text
    GROUP BY client_code
  ),
  -- Get previous EOD balances
  prev_eod AS (
    SELECT investor_code, ledger_balance
    FROM public.eod_ledger_snapshots
    WHERE eod_date = v_prev_eod_date
  ),
  -- Calculate new balances
  calculated_balances AS (
    SELECT 
      COALESCE(i.investor_code, t.client_code, d.investor_code, p.investor_code) as investor_code,
      i.investor_name,
      COALESCE(p.ledger_balance, 0) as opening_balance,
      COALESCE(d.deposits, 0) as deposits,
      COALESCE(d.withdrawals, 0) as withdrawals,
      COALESCE(t.gross_buy, 0) as gross_buy,
      COALESCE(t.gross_sell, 0) as gross_sell,
      COALESCE(t.brokerage, 0) as brokerage,
      -- Closing balance = Opening + Deposits - Withdrawals - Buy + Sell - Brokerage
      COALESCE(p.ledger_balance, 0) 
        + COALESCE(d.deposits, 0) 
        - COALESCE(d.withdrawals, 0) 
        - COALESCE(t.gross_buy, 0) 
        + COALESCE(t.gross_sell, 0) 
        - COALESCE(t.brokerage, 0) as closing_balance
    FROM public.investors i
    FULL OUTER JOIN day_trades t ON i.investor_code = t.client_code
    FULL OUTER JOIN day_deposits d ON COALESCE(i.investor_code, t.client_code) = d.investor_code
    FULL OUTER JOIN prev_eod p ON COALESCE(i.investor_code, t.client_code, d.investor_code) = p.investor_code
    WHERE (t.client_code IS NOT NULL OR d.investor_code IS NOT NULL OR p.investor_code IS NOT NULL)
  )
  -- Insert EOD snapshots
  INSERT INTO public.eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    ledger_balance,
    rm_email,
    created_by
  )
  SELECT 
    p_eod_date,
    cb.investor_code,
    cb.investor_name,
    cb.closing_balance,
    (SELECT rm_email FROM public.investor_rm_assignments WHERE investor_code = cb.investor_code LIMIT 1),
    auth.uid()
  FROM calculated_balances cb;

  -- Get counts and totals
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_balance
  FROM public.eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Get deposit/withdrawal totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_count, v_total_deposits, v_total_withdrawals
  FROM public.deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Record the run in history
  INSERT INTO public.eod_run_history (
    run_date,
    status,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    deposit_records_count,
    run_by,
    run_by_email,
    notes
  ) VALUES (
    p_eod_date,
    'completed',
    v_clients_captured,
    v_total_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_deposit_count,
    auth.uid(),
    (SELECT email FROM public.profiles WHERE id = auth.uid()),
    format('EOD completed. Previous EOD date: %s', COALESCE(v_prev_eod_date::text, 'None (first run)'))
  )
  RETURNING id INTO v_run_id;

  RETURN json_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_balance', v_total_balance,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'previous_eod_date', v_prev_eod_date,
    'run_id', v_run_id
  );

EXCEPTION WHEN OTHERS THEN
  -- Log error and return failure
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'eod_date', p_eod_date
  );
END;
$$;