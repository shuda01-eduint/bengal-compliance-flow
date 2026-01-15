
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date date, p_end_date date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date;
  v_has_prev boolean;
  v_prev_date date;
  v_inserted int;
  v_total_balance numeric;
  v_days_processed int := 0;
  v_results json[] := ARRAY[]::json[];
BEGIN
  -- Loop through each date in range
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    -- Check if this date already has EOD run
    IF EXISTS (SELECT 1 FROM eod_run_history WHERE run_date = v_current_date AND status = 'completed') THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;
    
    -- Delete any existing snapshots for this date (in case of partial run)
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- FIXED: Find the most recent EOD date before current date (not just previous day)
    SELECT MAX(eod_date) INTO v_prev_date
    FROM eod_ledger_snapshots 
    WHERE eod_date < v_current_date;
    
    v_has_prev := v_prev_date IS NOT NULL;
    
    IF v_has_prev THEN
      -- Calculate from previous EOD snapshot + today's activity
      INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
      SELECT 
        v_current_date,
        COALESCE(prev.investor_code, t.client_code, dw.investor_code) as investor_code,
        COALESCE(i.investor_name, prev.investor_name) as investor_name,
        COALESCE(prev.ledger_balance, 0) 
          + COALESCE(t.net_value, 0) 
          + COALESCE(dw.net_deposit, 0)
          - COALESCE(t.commission, 0) as ledger_balance,
        COALESCE(prev.rm_email, i.email) as rm_email
      FROM (
        -- Get all investor codes from previous EOD
        SELECT DISTINCT investor_code, investor_name, ledger_balance, rm_email
        FROM eod_ledger_snapshots
        WHERE eod_date = v_prev_date
      ) prev
      FULL OUTER JOIN (
        -- Today's trades aggregated
        SELECT 
          client_code,
          SUM(CASE WHEN side = 'B' THEN -value ELSE value END) as net_value,
          SUM(COALESCE(brokerage_commission, 0)) as commission
        FROM trade_history
        WHERE trade_date = v_current_date::text
        GROUP BY client_code
      ) t ON prev.investor_code = t.client_code
      FULL OUTER JOIN (
        -- Today's deposits/withdrawals aggregated
        SELECT 
          investor_code,
          SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE -amount END) as net_deposit
        FROM deposits_withdrawals
        WHERE transaction_date = v_current_date
        GROUP BY investor_code
      ) dw ON COALESCE(prev.investor_code, t.client_code) = dw.investor_code
      LEFT JOIN investors i ON COALESCE(prev.investor_code, t.client_code, dw.investor_code) = i.investor_code
      WHERE COALESCE(prev.investor_code, t.client_code, dw.investor_code) IS NOT NULL;
    ELSE
      -- First run: Seed from balances_raw or clients table
      INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
      SELECT 
        v_current_date,
        COALESCE(br.investor_code, c.inv_code) as investor_code,
        COALESCE(i.investor_name, c.investor_name) as investor_name,
        COALESCE(br.ledger_balance, c.ledger_balance, 0) 
          + COALESCE(t.net_value, 0) 
          + COALESCE(dw.net_deposit, 0)
          - COALESCE(t.commission, 0) as ledger_balance,
        COALESCE(br.rm_email, c.rm_email) as rm_email
      FROM (
        -- Get seed balances - prefer balances_raw, fall back to clients
        SELECT DISTINCT ON (investor_code) investor_code, ledger_balance, rm_email
        FROM balances_raw
        ORDER BY investor_code, as_of_date DESC
      ) br
      FULL OUTER JOIN (
        SELECT inv_code, investor_name, ledger_balance, rm_email FROM clients
      ) c ON br.investor_code = c.inv_code
      LEFT JOIN (
        -- Today's trades aggregated
        SELECT 
          client_code,
          SUM(CASE WHEN side = 'B' THEN -value ELSE value END) as net_value,
          SUM(COALESCE(brokerage_commission, 0)) as commission
        FROM trade_history
        WHERE trade_date = v_current_date::text
        GROUP BY client_code
      ) t ON COALESCE(br.investor_code, c.inv_code) = t.client_code
      LEFT JOIN (
        -- Today's deposits/withdrawals aggregated
        SELECT 
          investor_code,
          SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE -amount END) as net_deposit
        FROM deposits_withdrawals
        WHERE transaction_date = v_current_date
        GROUP BY investor_code
      ) dw ON COALESCE(br.investor_code, c.inv_code) = dw.investor_code
      LEFT JOIN investors i ON COALESCE(br.investor_code, c.inv_code) = i.investor_code
      WHERE COALESCE(br.investor_code, c.inv_code) IS NOT NULL;
    END IF;
    
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    
    -- Calculate total balance for this date
    SELECT COALESCE(SUM(ledger_balance), 0) INTO v_total_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date;
    
    -- Record in run history
    INSERT INTO eod_run_history (run_date, status, clients_captured, total_ledger_balance, notes)
    VALUES (v_current_date, 'completed', v_inserted, v_total_balance, 
      CASE WHEN v_has_prev THEN 'Calculated from EOD ' || v_prev_date::text ELSE 'Initial seed from balances_raw/clients' END);
    
    v_results := v_results || json_build_object(
      'date', v_current_date,
      'clients', v_inserted,
      'total_balance', v_total_balance,
      'source', CASE WHEN v_has_prev THEN 'prev_eod_' || v_prev_date::text ELSE 'seed' END
    )::json;
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN json_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'results', to_json(v_results)
  );
END;
$$;
