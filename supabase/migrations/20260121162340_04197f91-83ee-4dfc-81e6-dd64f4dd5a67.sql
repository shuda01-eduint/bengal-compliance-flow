-- Add missing columns to eod_run_history
ALTER TABLE eod_run_history 
  ADD COLUMN IF NOT EXISTS gross_buy numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_sell numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_commission numeric DEFAULT 0;

-- Recreate run_batch_eod with correct column mappings and 120s timeout
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_clients_captured int := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_trade_files_count int := 0;
  v_total_ledger_balance numeric := 0;
  v_prev_date date;
BEGIN
  -- Auth check
  v_user_id := auth.uid();
  v_user_email := auth.jwt() ->> 'email';
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can run EOD';
  END IF;

  v_prev_date := p_eod_date - 1;

  -- Skip if already exists
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'date', p_eod_date);
  END IF;

  -- Delete existing for re-run
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Build investor list + calculate balances
  WITH investor_list AS (
    SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
    UNION
    SELECT inv_code AS investor_code FROM clients WHERE inv_code IS NOT NULL
    UNION
    SELECT investor_code FROM investors WHERE investor_code IS NOT NULL
  ),
  prev_balances AS (
    SELECT investor_code, closing_balance, ledger_balance
    FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
  ),
  client_balances AS (
    SELECT inv_code, ledger_balance FROM clients
  ),
  trade_activity AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as buy_value,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as sell_value,
      SUM(COALESCE(th.brokerage_commission, 0)) as commission
    FROM trade_history th
    WHERE th.trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND COALESCE(th.status, th.fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY th.client_code
  ),
  txn_activity AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, rm_email,
    opening_balance, total_deposits, total_withdrawals,
    gross_buy, gross_sell, total_commission, net_trade_value,
    closing_balance, ledger_balance, created_by
  )
  SELECT 
    p_eod_date,
    il.investor_code,
    COALESCE(i.investor_name, c.investor_name),
    c.rm_email,
    COALESCE(pb.closing_balance, pb.ledger_balance, cb.ledger_balance, 0) as opening,
    COALESCE(tx.deposits, 0),
    COALESCE(tx.withdrawals, 0),
    COALESCE(ta.buy_value, 0),
    COALESCE(ta.sell_value, 0),
    COALESCE(ta.commission, 0),
    COALESCE(ta.sell_value, 0) - COALESCE(ta.buy_value, 0) - COALESCE(ta.commission, 0),
    COALESCE(pb.closing_balance, pb.ledger_balance, cb.ledger_balance, 0)
      + COALESCE(tx.deposits, 0)
      - COALESCE(tx.withdrawals, 0)
      + COALESCE(ta.sell_value, 0)
      - COALESCE(ta.buy_value, 0)
      - COALESCE(ta.commission, 0),
    COALESCE(pb.ledger_balance, cb.ledger_balance, 0),
    v_user_id
  FROM investor_list il
  LEFT JOIN prev_balances pb ON pb.investor_code = il.investor_code
  LEFT JOIN client_balances cb ON cb.inv_code = il.investor_code
  LEFT JOIN investors i ON i.investor_code = il.investor_code
  LEFT JOIN clients c ON c.inv_code = il.investor_code
  LEFT JOIN trade_activity ta ON ta.client_code = il.investor_code
  LEFT JOIN txn_activity tx ON tx.investor_code = il.investor_code;

  -- Get aggregates
  SELECT 
    COUNT(*), 
    COALESCE(SUM(gross_buy), 0), 
    COALESCE(SUM(gross_sell), 0), 
    COALESCE(SUM(total_commission), 0), 
    COALESCE(SUM(closing_balance), 0)
  INTO v_clients_captured, v_gross_buy, v_gross_sell, v_total_commission, v_total_ledger_balance
  FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  SELECT 
    COALESCE(SUM(total_deposits), 0), 
    COALESCE(SUM(total_withdrawals), 0)
  INTO v_total_deposits, v_total_withdrawals
  FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  SELECT COUNT(DISTINCT file_name)
  INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD');

  -- Insert run history with CORRECT column mapping (UUID for run_by, text for run_by_email)
  INSERT INTO eod_run_history (
    run_date, run_by, run_by_email, clients_captured,
    total_deposits, total_withdrawals, gross_buy, gross_sell, total_commission,
    trade_files_count, total_ledger_balance, status
  ) VALUES (
    p_eod_date, v_user_id, v_user_email, v_clients_captured,
    v_total_deposits, v_total_withdrawals, v_gross_buy, v_gross_sell, v_total_commission,
    v_trade_files_count, v_total_ledger_balance, 'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'date', p_eod_date,
    'clients_captured', v_clients_captured,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals
  );
END;
$$;