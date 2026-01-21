-- Drop existing function overloads and recreate with correct schema
DROP FUNCTION IF EXISTS public.run_batch_eod(date, boolean);
DROP FUNCTION IF EXISTS public.run_batch_eod(text, text);

-- Create the corrected run_batch_eod function
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
  v_existing_count integer;
  v_clients_count integer := 0;
  v_total_ledger numeric := 0;
  v_trade_files integer := 0;
  v_deposit_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_user_id uuid;
  v_user_email text;
  v_trade_date_str text;
  v_prev_date date;
BEGIN
  -- Authorization: Only admins can run EOD
  v_user_id := auth.uid();
  IF NOT has_role(v_user_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can run EOD process';
  END IF;

  -- Get user email for audit
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Check for existing EOD data
  SELECT COUNT(*) INTO v_existing_count
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  IF v_existing_count > 0 AND p_skip_existing THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists, skipped', p_eod_date),
      'clients_captured', 0
    );
  END IF;

  -- Delete existing data for this date if re-running
  IF v_existing_count > 0 THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Prepare date values
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_prev_date := p_eod_date - INTERVAL '1 day';

  -- Insert EOD snapshots for all investors
  WITH investor_list AS (
    -- Union of all possible investor sources
    SELECT DISTINCT investor_code, investor_name, rm_email
    FROM (
      -- From previous day snapshots
      SELECT investor_code, investor_name, rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
      UNION
      -- From clients table
      SELECT inv_code AS investor_code, investor_name, rm_email
      FROM clients
      UNION
      -- From investors table
      SELECT investor_code, investor_name, NULL AS rm_email
      FROM investors
    ) all_investors
  ),
  opening_balances AS (
    SELECT 
      il.investor_code,
      il.investor_name,
      COALESCE(il.rm_email, c.rm_email) AS rm_email,
      COALESCE(
        prev.closing_balance,
        prev.ledger_balance,
        c.ledger_balance,
        0
      ) AS opening_balance
    FROM investor_list il
    LEFT JOIN eod_ledger_snapshots prev 
      ON prev.investor_code = il.investor_code 
      AND prev.eod_date = v_prev_date
    LEFT JOIN clients c ON c.inv_code = il.investor_code
  ),
  trade_aggregates AS (
    SELECT 
      th.investor_code,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'BUY' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'SELL' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) AS gross_sell,
      SUM(
        COALESCE(th.value, th.quantity * th.price) * 
        COALESCE(
          CASE WHEN th.brokerage_commission > 1 THEN th.brokerage_commission / 100.0 ELSE th.brokerage_commission END,
          (SELECT CASE WHEN i.brokerage_commission > 1 THEN i.brokerage_commission / 100.0 ELSE COALESCE(i.brokerage_commission, 0) END FROM investors i WHERE i.investor_code = th.investor_code),
          0
        )
      ) AS total_commission
    FROM trade_history th
    WHERE th.trade_date = v_trade_date_str
      AND (
        UPPER(COALESCE(th.status, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
        OR UPPER(COALESCE(th.fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
      )
    GROUP BY th.investor_code
  ),
  deposit_aggregates AS (
    SELECT 
      dw.investor_code,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END) AS total_withdrawals
    FROM deposits_withdrawals dw
    WHERE dw.transaction_date = p_eod_date
    GROUP BY dw.investor_code
  ),
  final_snapshots AS (
    SELECT
      ob.investor_code,
      ob.investor_name,
      ob.rm_email,
      ob.opening_balance,
      COALESCE(ta.gross_buy, 0) AS gross_buy,
      COALESCE(ta.gross_sell, 0) AS gross_sell,
      COALESCE(da.total_deposits, 0) AS total_deposits,
      COALESCE(da.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(ta.total_commission, 0) AS total_commission,
      -- Net trade value = Gross Sell - Gross Buy - Commission
      (COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0)) AS net_trade_value,
      -- Closing = Opening + Deposits - Withdrawals + Net Trade Value
      (ob.opening_balance 
        + COALESCE(da.total_deposits, 0) 
        - COALESCE(da.total_withdrawals, 0) 
        + (COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0) - COALESCE(ta.total_commission, 0))
      ) AS closing_balance
    FROM opening_balances ob
    LEFT JOIN trade_aggregates ta ON ta.investor_code = ob.investor_code
    LEFT JOIN deposit_aggregates da ON da.investor_code = ob.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_email,
    opening_balance,
    closing_balance,
    ledger_balance,
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value,
    created_by
  )
  SELECT
    p_eod_date,
    investor_code,
    investor_name,
    rm_email,
    opening_balance,
    closing_balance,
    closing_balance, -- ledger_balance = closing_balance for compatibility
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value,
    v_user_id
  FROM final_snapshots;

  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0)
  INTO 
    v_clients_count,
    v_total_ledger,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Count trade files
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files
  FROM trade_history
  WHERE trade_date = v_trade_date_str;

  -- Count deposit/withdrawal records
  SELECT COUNT(*) INTO v_deposit_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Insert run history
  INSERT INTO eod_run_history (
    run_date,
    run_at,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    status
  ) VALUES (
    p_eod_date,
    now(),
    v_user_id,
    v_user_email,
    v_clients_count,
    v_total_ledger,
    v_trade_files,
    v_deposit_count,
    v_total_deposits,
    v_total_withdrawals,
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'clients_captured', v_clients_count,
    'total_ledger_balance', v_total_ledger,
    'trade_files_count', v_trade_files,
    'deposit_records_count', v_deposit_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission
  );
END;
$$;