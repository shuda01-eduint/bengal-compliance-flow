
-- Fix run_batch_eod function: commission calculation and transaction type case sensitivity
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  v_result jsonb;
  v_processed int := 0;
  v_skipped int := 0;
  v_errors text[] := ARRAY[]::text[];
  v_user_role text;
BEGIN
  -- Check if user has admin role
  SELECT 
    CASE WHEN EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    ) THEN 'admin' ELSE 'user' END
  INTO v_user_role;
  
  IF v_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin role required'
    );
  END IF;

  -- Delete existing records for this date if not skipping
  IF NOT p_skip_existing THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  END IF;

  -- Insert EOD snapshots for all investors
  WITH 
  -- Get previous day's closing balances
  prev_day AS (
    SELECT investor_code, closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - 1
  ),
  -- Get all investors from multiple sources
  all_investors AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM prev_day
      UNION
      SELECT investor_code FROM clients WHERE investor_code IS NOT NULL
      UNION
      SELECT investor_code FROM investors WHERE investor_code IS NOT NULL
    ) combined
  ),
  -- Get trade activity for the day with CORRECT commission calculation
  trade_activity AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as buy_value,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as sell_value,
      -- FIX: Calculate commission as value × (rate / 100)
      SUM(
        COALESCE(th.value, th.quantity * th.price) * 
        CASE 
          WHEN COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.4) >= 0.1 
          THEN COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.4) / 100
          ELSE COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.004)
        END
      ) as commission
    FROM trade_history th
    LEFT JOIN investors inv ON th.client_code = inv.investor_code
    WHERE th.trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND COALESCE(th.status, th.fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY th.client_code
  ),
  -- Get deposits/withdrawals for the day with CORRECT case sensitivity
  txn_activity AS (
    SELECT 
      investor_code,
      -- FIX: Use Title Case to match actual data in deposits_withdrawals table
      SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Calculate EOD for each investor
  eod_calc AS (
    SELECT 
      ai.investor_code,
      COALESCE(pd.closing_balance, 0) as opening_balance,
      COALESCE(ta.sell_value, 0) as sell_value,
      COALESCE(ta.buy_value, 0) as buy_value,
      COALESCE(ta.commission, 0) as commission,
      COALESCE(tx.deposits, 0) as deposits,
      COALESCE(tx.withdrawals, 0) as withdrawals,
      -- Closing = Opening + Deposits - Withdrawals + Sell - Buy - Commission
      COALESCE(pd.closing_balance, 0) 
        + COALESCE(tx.deposits, 0) 
        - COALESCE(tx.withdrawals, 0)
        + COALESCE(ta.sell_value, 0) 
        - COALESCE(ta.buy_value, 0) 
        - COALESCE(ta.commission, 0) as closing_balance
    FROM all_investors ai
    LEFT JOIN prev_day pd ON ai.investor_code = pd.investor_code
    LEFT JOIN trade_activity ta ON ai.investor_code = ta.client_code
    LEFT JOIN txn_activity tx ON ai.investor_code = tx.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    opening_balance,
    sell_value,
    buy_value,
    commission,
    deposits,
    withdrawals,
    closing_balance
  )
  SELECT 
    p_eod_date,
    investor_code,
    opening_balance,
    sell_value,
    buy_value,
    commission,
    deposits,
    withdrawals,
    closing_balance
  FROM eod_calc
  WHERE NOT (p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots es 
    WHERE es.eod_date = p_eod_date AND es.investor_code = eod_calc.investor_code
  ));

  GET DIAGNOSTICS v_processed = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'date', p_eod_date
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'date', p_eod_date
  );
END;
$$;

-- Fix existing Jan 12 baseline data: set closing_balance = ledger_balance where closing_balance is 0
UPDATE eod_ledger_snapshots 
SET closing_balance = ledger_balance
WHERE eod_date = '2025-01-12' AND closing_balance = 0 AND ledger_balance != 0;
