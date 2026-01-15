-- Update run_batch_eod to include commission deductions
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date date, p_end_date date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_current_date date;
  v_total_snapshots integer := 0;
  v_days_processed integer := 0;
  v_total_days integer;
  v_day_snapshots integer;
  v_has_prev boolean;
  v_seed_date date;
BEGIN
  v_total_days := p_end_date - p_start_date + 1;
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    v_has_prev := EXISTS (
      SELECT 1 FROM eod_ledger_snapshots 
      WHERE eod_date = v_current_date - 1 
      LIMIT 1
    );
    
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    IF v_has_prev THEN
      WITH prev_eod AS (
        SELECT investor_code, investor_name, ledger_balance, rm_email
        FROM eod_ledger_snapshots
        WHERE eod_date = v_current_date - 1
      ),
      daily_trades AS (
        SELECT 
          client_code as investor_code,
          COALESCE(SUM(CASE WHEN UPPER(side) IN ('B', 'BUY') THEN value ELSE 0 END), 0) as buy_value,
          COALESCE(SUM(CASE WHEN UPPER(side) IN ('S', 'SELL') THEN value ELSE 0 END), 0) as sell_value,
          COALESCE(SUM(value * COALESCE(brokerage_commission, 0.004)), 0) as commission
        FROM trade_history t
        WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
        GROUP BY client_code
      ),
      daily_deposits AS (
        SELECT 
          investor_code,
          COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END), 0) as deposits,
          COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END), 0) as withdrawals
        FROM deposits_withdrawals
        WHERE transaction_date = v_current_date
        GROUP BY investor_code
      ),
      all_investors AS (
        SELECT DISTINCT investor_code FROM prev_eod
        UNION
        SELECT DISTINCT investor_code FROM daily_trades
        UNION
        SELECT DISTINCT investor_code FROM daily_deposits
        UNION
        SELECT DISTINCT inv_code as investor_code FROM clients
      ),
      calculated AS (
        SELECT 
          ai.investor_code,
          COALESCE(pe.investor_name, c.investor_name) as investor_name,
          COALESCE(pe.rm_email, c.rm_email) as rm_email,
          COALESCE(pe.ledger_balance, c.ledger_balance, 0) 
            + COALESCE(dd.deposits, 0) 
            - COALESCE(dd.withdrawals, 0) 
            - COALESCE(dt.buy_value, 0) 
            + COALESCE(dt.sell_value, 0)
            - COALESCE(dt.commission, 0) as calculated_ledger
        FROM all_investors ai
        LEFT JOIN prev_eod pe ON pe.investor_code = ai.investor_code
        LEFT JOIN daily_trades dt ON dt.investor_code = ai.investor_code
        LEFT JOIN daily_deposits dd ON dd.investor_code = ai.investor_code
        LEFT JOIN clients c ON c.inv_code = ai.investor_code
      )
      INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
      SELECT v_current_date, investor_code, investor_name, calculated_ledger, rm_email
      FROM calculated
      WHERE investor_code IS NOT NULL;
      
    ELSE
      SELECT max(as_of_date) INTO v_seed_date
      FROM balances_raw 
      WHERE as_of_date <= v_current_date;
      
      WITH seed_balances AS (
        SELECT 
          investor_code,
          max(ledger_balance) as ledger_balance,
          max(rm_email) as rm_email,
          max(rm_name) as rm_name
        FROM balances_raw
        WHERE as_of_date = v_seed_date
        GROUP BY investor_code
      ),
      daily_trades AS (
        SELECT 
          client_code as investor_code,
          COALESCE(SUM(CASE WHEN UPPER(side) IN ('B', 'BUY') THEN value ELSE 0 END), 0) as buy_value,
          COALESCE(SUM(CASE WHEN UPPER(side) IN ('S', 'SELL') THEN value ELSE 0 END), 0) as sell_value,
          COALESCE(SUM(value * COALESCE(brokerage_commission, 0.004)), 0) as commission
        FROM trade_history t
        WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
        GROUP BY client_code
      ),
      daily_deposits AS (
        SELECT 
          investor_code,
          COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END), 0) as deposits,
          COALESCE(SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END), 0) as withdrawals
        FROM deposits_withdrawals
        WHERE transaction_date = v_current_date
        GROUP BY investor_code
      ),
      all_investors AS (
        SELECT DISTINCT investor_code FROM seed_balances
        UNION
        SELECT DISTINCT investor_code FROM daily_trades
        UNION
        SELECT DISTINCT investor_code FROM daily_deposits
        UNION
        SELECT DISTINCT inv_code as investor_code FROM clients
      ),
      calculated AS (
        SELECT 
          ai.investor_code,
          COALESCE(c.investor_name) as investor_name,
          COALESCE(sb.rm_email, c.rm_email) as rm_email,
          COALESCE(sb.ledger_balance, c.ledger_balance, 0) 
            + COALESCE(dd.deposits, 0) 
            - COALESCE(dd.withdrawals, 0) 
            - COALESCE(dt.buy_value, 0) 
            + COALESCE(dt.sell_value, 0)
            - COALESCE(dt.commission, 0) as calculated_ledger
        FROM all_investors ai
        LEFT JOIN seed_balances sb ON sb.investor_code = ai.investor_code
        LEFT JOIN daily_trades dt ON dt.investor_code = ai.investor_code
        LEFT JOIN daily_deposits dd ON dd.investor_code = ai.investor_code
        LEFT JOIN clients c ON c.inv_code = ai.investor_code
      )
      INSERT INTO eod_ledger_snapshots (eod_date, investor_code, investor_name, ledger_balance, rm_email)
      SELECT v_current_date, investor_code, investor_name, calculated_ledger, rm_email
      FROM calculated
      WHERE investor_code IS NOT NULL;
    END IF;
    
    GET DIAGNOSTICS v_day_snapshots = ROW_COUNT;
    v_total_snapshots := v_total_snapshots + v_day_snapshots;
    
    INSERT INTO eod_run_history (run_date, status, clients_captured, total_ledger_balance, notes)
    SELECT v_current_date, 'completed', count(*), COALESCE(sum(ledger_balance), 0),
      CASE WHEN v_has_prev THEN 'Sequential run with commissions' ELSE 'Seeded from balances_raw with commissions' END
    FROM eod_ledger_snapshots
    WHERE eod_date = v_current_date;
    
    v_days_processed := v_days_processed + 1;
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN json_build_object(
    'success', true,
    'days_processed', v_days_processed,
    'total_snapshots', v_total_snapshots,
    'start_date', p_start_date,
    'end_date', p_end_date
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'days_processed', v_days_processed,
    'total_snapshots', v_total_snapshots
  );
END;
$function$;