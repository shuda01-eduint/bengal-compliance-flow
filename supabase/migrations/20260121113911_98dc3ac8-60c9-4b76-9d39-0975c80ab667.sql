-- Phase 1: Add commission tracking columns to investors table
ALTER TABLE public.investors
ADD COLUMN IF NOT EXISTS commission_effective_date date DEFAULT NULL,
ADD COLUMN IF NOT EXISTS commission_updated_by uuid DEFAULT NULL,
ADD COLUMN IF NOT EXISTS commission_notes text DEFAULT NULL;

-- Phase 2: Update run_batch_eod function to use investors.brokerage_commission
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_captured int := 0;
  v_total_ledger numeric := 0;
  v_trade_files int := 0;
  v_deposit_records int := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_previous_date date;
  v_has_previous_eod boolean := false;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing EOD data for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Find the previous EOD date
  SELECT MAX(eod_date) INTO v_previous_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  v_has_previous_eod := v_previous_date IS NOT NULL;

  -- Count trade files for this date
  SELECT COUNT(DISTINCT upload_batch_id) INTO v_trade_files
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Count deposit records and sums
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Insert new EOD snapshots
  WITH previous_balances AS (
    SELECT investor_code, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_previous_date
  ),
  deposits AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      th.client_code as investor_code,
      SUM(
        CASE 
          WHEN UPPER(th.side) IN ('BUY', 'B') THEN 
            -COALESCE(th.value, th.quantity * th.price) 
            - (COALESCE(th.value, th.quantity * th.price) * (COALESCE(i.brokerage_commission, 0.4) / 100))
          WHEN UPPER(th.side) IN ('SELL', 'S') THEN 
            COALESCE(th.value, th.quantity * th.price) 
            - (COALESCE(th.value, th.quantity * th.price) * (COALESCE(i.brokerage_commission, 0.4) / 100))
          ELSE 0
        END
      ) as net_trade_value
    FROM trade_history th
    LEFT JOIN investors i ON th.client_code = i.investor_code
    WHERE th.trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
      AND (th.status IN ('FILL', 'PF') OR th.fill_type IN ('FILL', 'PF'))
    GROUP BY th.client_code
  ),
  all_investors AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM previous_balances
      UNION
      SELECT investor_code FROM deposits
      UNION
      SELECT investor_code FROM day_trades
    ) combined
  )
  INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email, created_by)
  SELECT 
    p_eod_date,
    ai.investor_code,
    inv.investor_name,
    ROUND(
      COALESCE(pb.ledger_balance, 0) 
      + COALESCE(d.total_deposits, 0) 
      - COALESCE(d.total_withdrawals, 0)
      + COALESCE(dt.net_trade_value, 0)
    , 2) as ledger_balance,
    rm.rm_email,
    auth.uid()
  FROM all_investors ai
  LEFT JOIN previous_balances pb ON ai.investor_code = pb.investor_code
  LEFT JOIN deposits d ON ai.investor_code = d.investor_code
  LEFT JOIN day_trades dt ON ai.investor_code = dt.investor_code
  LEFT JOIN investors inv ON ai.investor_code = inv.investor_code
  LEFT JOIN investor_rm_assignments rm ON ai.investor_code = rm.investor_code;

  -- Get summary stats
  SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record in history
  INSERT INTO eod_run_history (
    run_date, 
    clients_captured, 
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    run_by,
    run_by_email,
    status,
    notes
  )
  VALUES (
    p_eod_date,
    v_clients_captured,
    v_total_ledger,
    v_trade_files,
    v_deposit_records,
    v_total_deposits,
    v_total_withdrawals,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    'completed',
    CASE WHEN v_has_previous_eod 
      THEN 'Calculated from previous EOD: ' || v_previous_date::text
      ELSE 'No previous EOD found - used zero as base'
    END
  );

  v_result := jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger,
    'trade_files_count', v_trade_files,
    'deposit_records_count', v_deposit_records,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'previous_eod_date', v_previous_date,
    'had_previous_eod', v_has_previous_eod
  );

  RETURN v_result;
END;
$$;