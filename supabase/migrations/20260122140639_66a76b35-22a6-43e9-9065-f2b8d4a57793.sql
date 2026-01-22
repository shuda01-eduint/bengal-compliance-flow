
-- Fix run_batch_eod function to call has_role with correct arguments
CREATE OR REPLACE FUNCTION public.run_batch_eod(
  p_eod_date date,
  p_skip_existing boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $$
DECLARE
  v_start_time timestamptz := clock_timestamp();
  v_processed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_user_email text;
  v_prev_date date;
  v_trade_date_str text;
BEGIN
  -- Check admin role - FIX: use auth.uid() as first argument
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Get user email for audit
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Calculate previous business date
  v_prev_date := p_eod_date - 1;
  
  -- Format trade_date for trade_history (TEXT column in YYYYMMDD format)
  v_trade_date_str := TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Skip if already exists and skip_existing is true
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed', 0,
      'skipped', 1,
      'message', 'EOD already exists for this date',
      'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000
    );
  END IF;

  -- Main EOD processing using set-based operations
  WITH 
  -- Get all investors from master table with RM info
  inv AS (
    SELECT
      UPPER(i.investor_code) AS investor_code,
      i.investor_name,
      COALESCE(i.ledger_balance, 0) AS base_balance,
      COALESCE(i.brokerage_commission, 0.4) AS brokerage_commission_raw,
      COALESCE(i.account_type, 'Regular') AS account_type,
      COALESCE(i.interest_rate, 0) AS interest_rate,
      COALESCE(i.rm_id, '') AS rm_id,
      COALESCE(i.rm_name, '') AS rm_name,
      COALESCE(i.department, '') AS department
    FROM public.investors i
    WHERE i.investor_code IS NOT NULL
  ),
  
  -- Get previous day closing balances
  prev_eod AS (
    SELECT 
      investor_code,
      closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  
  -- Aggregate trades for the EOD date (trade_date is TEXT in YYYYMMDD format)
  trades AS (
    SELECT
      UPPER(client_code) AS investor_code,
      COALESCE(SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN COALESCE(value, 0) ELSE 0 END), 0) AS gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(side) IN ('SELL', 'S') THEN COALESCE(value, 0) ELSE 0 END), 0) AS gross_sell
    FROM trade_history
    WHERE trade_date = v_trade_date_str
    GROUP BY UPPER(client_code)
  ),
  
  -- Aggregate deposits/withdrawals for the EOD date
  txns AS (
    SELECT
      UPPER(investor_code) AS investor_code,
      COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY UPPER(investor_code)
  ),
  
  -- Build universe of all investors with activity
  universe AS (
    SELECT investor_code FROM inv
    UNION
    SELECT investor_code FROM trades
    UNION
    SELECT investor_code FROM txns
    UNION
    SELECT investor_code FROM prev_eod
  ),
  
  -- Calculate final values for each investor
  final AS (
    SELECT
      u.investor_code,
      COALESCE(inv.investor_name, '') AS investor_name,
      COALESCE(inv.account_type, 'Regular') AS account_type,
      COALESCE(inv.interest_rate, 0) AS interest_rate,
      -- Normalize brokerage rate (>= 0.1 means percentage, otherwise decimal)
      CASE 
        WHEN COALESCE(inv.brokerage_commission_raw, 0.4) >= 0.1 
        THEN COALESCE(inv.brokerage_commission_raw, 0.4) / 100
        ELSE COALESCE(inv.brokerage_commission_raw, 0.004)
      END AS brokerage_rate,
      COALESCE(inv.rm_id, '') AS rm_id,
      COALESCE(inv.rm_name, '') AS rm_name,
      COALESCE(inv.department, '') AS department,
      -- Opening balance: previous EOD closing or base balance
      COALESCE(prev.closing_balance, inv.base_balance, 0) AS opening_balance,
      COALESCE(txns.total_deposits, 0) AS total_deposits,
      COALESCE(txns.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(trades.gross_buy, 0) AS gross_buy,
      COALESCE(trades.gross_sell, 0) AS gross_sell,
      -- Commission = turnover * normalized_rate
      ROUND(
        (COALESCE(trades.gross_buy, 0) + COALESCE(trades.gross_sell, 0)) * 
        CASE 
          WHEN COALESCE(inv.brokerage_commission_raw, 0.4) >= 0.1 
          THEN COALESCE(inv.brokerage_commission_raw, 0.4) / 100
          ELSE COALESCE(inv.brokerage_commission_raw, 0.004)
        END,
        2
      ) AS total_commission
    FROM universe u
    LEFT JOIN inv ON u.investor_code = inv.investor_code
    LEFT JOIN prev_eod prev ON u.investor_code = prev.investor_code
    LEFT JOIN trades ON u.investor_code = trades.investor_code
    LEFT JOIN txns ON u.investor_code = txns.investor_code
  ),
  
  -- Insert into snapshots
  inserted AS (
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      account_type,
      interest_rate,
      brokerage_rate,
      rm_id,
      rm_name,
      department,
      opening_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      net_trade_value,
      closing_balance,
      ledger_balance,
      created_by
    )
    SELECT
      p_eod_date,
      f.investor_code,
      f.investor_name,
      f.account_type,
      f.interest_rate,
      f.brokerage_rate,
      f.rm_id,
      f.rm_name,
      f.department,
      f.opening_balance,
      f.total_deposits,
      f.total_withdrawals,
      f.gross_buy,
      f.gross_sell,
      f.total_commission,
      f.gross_sell - f.gross_buy AS net_trade_value,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Commission
      ROUND(
        f.opening_balance
        + f.total_deposits
        - f.total_withdrawals
        + f.gross_sell
        - f.gross_buy
        - f.total_commission,
        2
      ) AS closing_balance,
      -- ledger_balance mirrors closing_balance
      ROUND(
        f.opening_balance
        + f.total_deposits
        - f.total_withdrawals
        + f.gross_sell
        - f.gross_buy
        - f.total_commission,
        2
      ) AS ledger_balance,
      auth.uid()
    FROM final f
    ON CONFLICT (eod_date, investor_code) 
    DO UPDATE SET
      investor_name = EXCLUDED.investor_name,
      account_type = EXCLUDED.account_type,
      interest_rate = EXCLUDED.interest_rate,
      brokerage_rate = EXCLUDED.brokerage_rate,
      rm_id = EXCLUDED.rm_id,
      rm_name = EXCLUDED.rm_name,
      department = EXCLUDED.department,
      opening_balance = EXCLUDED.opening_balance,
      total_deposits = EXCLUDED.total_deposits,
      total_withdrawals = EXCLUDED.total_withdrawals,
      gross_buy = EXCLUDED.gross_buy,
      gross_sell = EXCLUDED.gross_sell,
      total_commission = EXCLUDED.total_commission,
      net_trade_value = EXCLUDED.net_trade_value,
      closing_balance = EXCLUDED.closing_balance,
      ledger_balance = EXCLUDED.ledger_balance,
      created_by = auth.uid()
    RETURNING investor_code
  )
  SELECT COUNT(*) INTO v_processed FROM inserted;

  -- Record the EOD run in history
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    status
  )
  SELECT
    p_eod_date,
    auth.uid(),
    v_user_email,
    v_processed,
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0),
    'completed'
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000,
    'message', format('EOD completed: %s investors processed', v_processed)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors || jsonb_build_object('error', SQLERRM, 'state', SQLSTATE),
    'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000,
    'message', format('EOD failed: %s', SQLERRM)
  );
END;
$$;
