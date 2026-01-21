CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_investors_processed int := 0;
  v_total_closing numeric := 0;
  v_total_opening numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_total_gross_buy numeric := 0;
  v_total_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_prev_date date;
  v_skipped boolean := false;
BEGIN
  -- Set extended timeout for batch processing
  SET LOCAL statement_timeout = '600s';
  
  -- Check if we should skip this date
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_run_history WHERE run_date = p_eod_date) THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'run_date', p_eod_date,
        'message', 'Skipped - EOD already exists for this date'
      );
    END IF;
  END IF;
  
  -- Find the previous business day (simplified - just previous day for now)
  v_prev_date := p_eod_date - interval '1 day';
  
  -- Delete existing snapshots for this date (to allow re-runs)
  DELETE FROM eod_ledger_snapshots WHERE snapshot_date = p_eod_date;
  
  -- Main EOD calculation with comprehensive investor coverage
  WITH all_investors AS (
    -- Three-way union to capture ALL investors
    SELECT DISTINCT inv_code
    FROM (
      -- From previous day snapshots
      SELECT investor_code as inv_code
      FROM eod_ledger_snapshots
      WHERE snapshot_date = v_prev_date
      
      UNION
      
      -- From clients table (using correct column name)
      SELECT inv_code
      FROM clients
      WHERE inv_code IS NOT NULL
      
      UNION
      
      -- From investors master table
      SELECT investor_code as inv_code
      FROM investors
      WHERE investor_code IS NOT NULL
    ) combined
  ),
  
  opening_balances AS (
    -- Get opening balance from previous day snapshot or clients table
    SELECT 
      ai.inv_code,
      COALESCE(
        (SELECT closing_balance FROM eod_ledger_snapshots 
         WHERE investor_code = ai.inv_code AND snapshot_date = v_prev_date),
        (SELECT opening_balance FROM clients WHERE inv_code = ai.inv_code),
        0
      ) as opening_balance
    FROM all_investors ai
  ),
  
  trade_activity AS (
    -- Get trade activity for the day (using correct column name)
    SELECT 
      client_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(value, quantity * price) ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(value, quantity * price) ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(brokerage_commission), 0) as total_commission
    FROM trade_history
    WHERE trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND UPPER(COALESCE(status, fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY client_code
  ),
  
  deposit_withdrawals AS (
    -- Get deposits and withdrawals for the day (using correct table name)
    SELECT 
      investor_code as inv_code,
      COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as total_deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as total_withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  calculated_balances AS (
    SELECT 
      ob.inv_code as investor_code,
      ob.opening_balance,
      COALESCE(dw.total_deposits, 0) as total_deposits,
      COALESCE(dw.total_withdrawals, 0) as total_withdrawals,
      COALESCE(ta.gross_buy, 0) as gross_buy,
      COALESCE(ta.gross_sell, 0) as gross_sell,
      COALESCE(ta.total_commission, 0) as total_commission,
      -- Net trade value calculation
      (COALESCE(ta.gross_sell, 0) - COALESCE(ta.gross_buy, 0)) as net_trade_value,
      -- Closing balance formula: Opening + Deposits - Withdrawals + (Sell - SellComm) - (Buy + BuyComm)
      -- Simplified: Opening + Deposits - Withdrawals + Sell - Buy - Commission
      ob.opening_balance 
        + COALESCE(dw.total_deposits, 0) 
        - COALESCE(dw.total_withdrawals, 0)
        + COALESCE(ta.gross_sell, 0)
        - COALESCE(ta.gross_buy, 0)
        - COALESCE(ta.total_commission, 0) as closing_balance
    FROM opening_balances ob
    LEFT JOIN trade_activity ta ON ta.inv_code = ob.inv_code
    LEFT JOIN deposit_withdrawals dw ON dw.inv_code = ob.inv_code
  ),
  
  inserted AS (
    INSERT INTO eod_ledger_snapshots (
      investor_code,
      snapshot_date,
      opening_balance,
      closing_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      net_trade_value
    )
    SELECT 
      investor_code,
      p_eod_date,
      opening_balance,
      closing_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      net_trade_value
    FROM calculated_balances
    RETURNING *
  )
  
  SELECT 
    COUNT(*)::int,
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(opening_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_investors_processed,
    v_total_closing,
    v_total_opening,
    v_total_deposits,
    v_total_withdrawals,
    v_total_gross_buy,
    v_total_gross_sell,
    v_total_commission
  FROM inserted;
  
  -- Upsert run history
  INSERT INTO eod_run_history (
    run_date,
    investors_processed,
    total_closing_balance,
    total_opening_balance,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission
  ) VALUES (
    p_eod_date,
    v_investors_processed,
    v_total_closing,
    v_total_opening,
    v_total_deposits,
    v_total_withdrawals,
    v_total_gross_buy,
    v_total_gross_sell,
    v_total_commission
  )
  ON CONFLICT (run_date) DO UPDATE SET
    investors_processed = EXCLUDED.investors_processed,
    total_closing_balance = EXCLUDED.total_closing_balance,
    total_opening_balance = EXCLUDED.total_opening_balance,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    gross_buy = EXCLUDED.gross_buy,
    gross_sell = EXCLUDED.gross_sell,
    total_commission = EXCLUDED.total_commission,
    run_at = now();
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'skipped', false,
    'run_date', p_eod_date,
    'investors_processed', v_investors_processed,
    'total_opening_balance', v_total_opening,
    'total_closing_balance', v_total_closing,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_total_gross_buy,
    'gross_sell', v_total_gross_sell,
    'total_commission', v_total_commission
  );
  
  RETURN v_result;
END;
$$;