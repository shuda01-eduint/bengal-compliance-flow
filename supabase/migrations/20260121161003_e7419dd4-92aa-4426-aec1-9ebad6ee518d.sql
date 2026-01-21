-- Drop all existing overloads of run_batch_eod
DROP FUNCTION IF EXISTS public.run_batch_eod(date);
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);

-- Recreate with correct trade_history column references
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_prev_date date;
  v_result jsonb;
  v_clients_captured int := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count int := 0;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check admin role
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can run EOD';
  END IF;

  -- Get user email from JWT
  v_user_email := COALESCE(auth.jwt() ->> 'email', 'unknown');

  -- Previous date for opening balance lookup
  v_prev_date := p_eod_date - 1;

  -- Skip if already run and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing snapshots for this date (re-run scenario)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Main EOD calculation and insert
  WITH investor_list AS (
    -- Union of all possible investors from 3 sources
    SELECT DISTINCT investor_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
    UNION
    SELECT DISTINCT inv_code AS investor_code FROM clients WHERE inv_code IS NOT NULL
    UNION
    SELECT DISTINCT investor_code FROM investors WHERE investor_code IS NOT NULL
  ),
  opening_balances AS (
    SELECT
      il.investor_code,
      COALESCE(
        prev.closing_balance,
        prev.ledger_balance,
        c.ledger_balance,
        0
      ) AS opening_balance
    FROM investor_list il
    LEFT JOIN eod_ledger_snapshots prev 
      ON prev.investor_code = il.investor_code AND prev.eod_date = v_prev_date
    LEFT JOIN clients c 
      ON c.inv_code = il.investor_code
  ),
  trade_aggregates AS (
    SELECT
      th.client_code AS investor_code,
      SUM(CASE WHEN UPPER(th.side) = 'BUY' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.side) = 'SELL' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) AS gross_sell,
      SUM(
        COALESCE(th.value, th.quantity * th.price) * 
        CASE 
          WHEN COALESCE(th.brokerage_commission, i.brokerage_commission, 0) >= 0.1 
          THEN COALESCE(th.brokerage_commission, i.brokerage_commission, 0) / 100
          ELSE COALESCE(th.brokerage_commission, i.brokerage_commission, 0)
        END
      ) AS total_commission,
      COUNT(DISTINCT th.file_name) AS trade_files
    FROM trade_history th
    LEFT JOIN investors i ON i.investor_code = th.client_code
    WHERE th.trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND UPPER(COALESCE(th.status, th.fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY th.client_code
  ),
  transaction_aggregates AS (
    SELECT
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN COALESCE(dw.amount, 0) ELSE 0 END) AS withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = p_eod_date
    GROUP BY dw.investor_code
  ),
  final_calc AS (
    SELECT
      ob.investor_code,
      ob.opening_balance,
      COALESCE(ta.gross_buy, 0) AS gross_buy,
      COALESCE(ta.gross_sell, 0) AS gross_sell,
      COALESCE(ta.total_commission, 0) AS total_commission,
      COALESCE(xa.deposits, 0) AS deposits,
      COALESCE(xa.withdrawals, 0) AS withdrawals,
      COALESCE(ta.trade_files, 0) AS trade_files,
      -- Closing = Opening + Deposits - Withdrawals + (Sell - Buy - Commission)
      ob.opening_balance 
        + COALESCE(xa.deposits, 0) 
        - COALESCE(xa.withdrawals, 0)
        + COALESCE(ta.gross_sell, 0)
        - COALESCE(ta.gross_buy, 0)
        - COALESCE(ta.total_commission, 0) AS closing_balance
    FROM opening_balances ob
    LEFT JOIN trade_aggregates ta ON ta.investor_code = ob.investor_code
    LEFT JOIN transaction_aggregates xa ON xa.investor_code = ob.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    investor_code,
    eod_date,
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value
  )
  SELECT
    fc.investor_code,
    p_eod_date,
    fc.opening_balance,
    fc.closing_balance,
    fc.gross_buy,
    fc.gross_sell,
    fc.deposits,
    fc.withdrawals,
    fc.total_commission,
    fc.gross_sell - fc.gross_buy - fc.total_commission
  FROM final_calc fc;

  -- Gather summary stats
  SELECT 
    COUNT(*),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_clients_captured,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Count distinct trade files for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD');

  -- Record the run in history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    clients_captured,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    trade_files_count
  ) VALUES (
    p_eod_date,
    v_user_email,
    v_clients_captured,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_trade_files_count
  );

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count
  );

  RETURN v_result;
END;
$$;