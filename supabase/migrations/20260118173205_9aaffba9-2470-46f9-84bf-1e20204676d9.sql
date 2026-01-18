-- Update run_batch_eod function to fix trade date format, side matching, and return correct field
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date text, p_end_date text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date;
  v_end_date date;
  v_total_clients integer := 0;
  v_total_balance numeric := 0;
  v_days_processed integer := 0;
  v_result json;
  v_trade_date_str text;
BEGIN
  v_current_date := p_start_date::date;
  v_end_date := p_end_date::date;

  -- Process each day in sequence
  WHILE v_current_date <= v_end_date LOOP
    -- Format trade date as YYYYMMDD to match trade_history.trade_date format
    v_trade_date_str := to_char(v_current_date, 'YYYYMMDD');
    
    -- Delete existing snapshots for this date
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;

    -- Insert new snapshots with corrected calculation
    WITH previous_day_balances AS (
      SELECT investor_code, ledger_balance
      FROM eod_ledger_snapshots
      WHERE eod_date = v_current_date - INTERVAL '1 day'
    ),
    opening_balances AS (
      SELECT 
        COALESCE(p.investor_code, c.inv_code) as investor_code,
        COALESCE(p.ledger_balance, c.ledger_balance, 0) as opening_balance,
        c.investor_name,
        c.rm_email
      FROM clients c
      LEFT JOIN previous_day_balances p ON p.investor_code = c.inv_code
    ),
    day_deposits AS (
      SELECT 
        investor_code,
        SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END) as deposits,
        SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    day_trades AS (
      SELECT 
        t.client_code as investor_code,
        SUM(CASE WHEN UPPER(t.side) IN ('BUY', 'B') THEN COALESCE(t.value, 0) ELSE 0 END) as total_buy,
        SUM(CASE WHEN UPPER(t.side) IN ('SELL', 'S') THEN COALESCE(t.value, 0) ELSE 0 END) as total_sell,
        -- Calculate commission as: value * normalized_rate
        -- Use trade-level commission if available, otherwise use investor default
        SUM(
          COALESCE(t.value, 0) * 
          CASE 
            WHEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) >= 0.1 
            THEN COALESCE(t.brokerage_commission, i.brokerage_commission, 0) / 100
            ELSE COALESCE(t.brokerage_commission, i.brokerage_commission, 0)
          END
        ) as total_commission
      FROM trade_history t
      LEFT JOIN investors i ON i.investor_code = t.client_code
      WHERE t.trade_date = v_trade_date_str
      GROUP BY t.client_code
    ),
    calculated_balances AS (
      SELECT 
        o.investor_code,
        o.investor_name,
        o.rm_email,
        o.opening_balance,
        COALESCE(d.deposits, 0) as deposits,
        COALESCE(d.withdrawals, 0) as withdrawals,
        COALESCE(t.total_buy, 0) as total_buy,
        COALESCE(t.total_sell, 0) as total_sell,
        COALESCE(t.total_commission, 0) as total_commission,
        -- Formula: opening + deposits - withdrawals - buys + sells - commission
        o.opening_balance 
          + COALESCE(d.deposits, 0) 
          - COALESCE(d.withdrawals, 0) 
          - COALESCE(t.total_buy, 0) 
          + COALESCE(t.total_sell, 0) 
          - COALESCE(t.total_commission, 0) as closing_balance
      FROM opening_balances o
      LEFT JOIN day_deposits d ON d.investor_code = o.investor_code
      LEFT JOIN day_trades t ON t.investor_code = o.investor_code
    )
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, rm_email, ledger_balance, created_at)
    SELECT 
      v_current_date,
      investor_code,
      investor_name,
      rm_email,
      closing_balance,
      now()
    FROM calculated_balances;

    -- Update counters
    SELECT COUNT(*), COALESCE(SUM(ledger_balance), 0)
    INTO v_total_clients, v_total_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date;

    -- Record in history
    INSERT INTO eod_run_history (run_date, clients_captured, total_ledger_balance, status, run_at)
    VALUES (v_current_date, v_total_clients, v_total_balance, 'completed', now())
    ON CONFLICT (run_date) DO UPDATE SET
      clients_captured = EXCLUDED.clients_captured,
      total_ledger_balance = EXCLUDED.total_ledger_balance,
      status = EXCLUDED.status,
      run_at = EXCLUDED.run_at;

    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  -- Return both field names for compatibility
  v_result := json_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'total_snapshots', v_total_clients,
    'final_clients', v_total_clients,
    'total_ledger_balance', v_total_balance,
    'final_balance', v_total_balance,
    'start_date', p_start_date,
    'end_date', p_end_date
  );

  RETURN v_result;
END;
$$;