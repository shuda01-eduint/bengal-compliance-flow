CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_run_id UUID;
  v_user_email TEXT;
  v_prev_date DATE;
  v_trade_date_str TEXT;
  v_investor RECORD;
  v_opening_balance NUMERIC;
  v_closing_balance NUMERIC;
  v_inv_deposits NUMERIC;
  v_inv_withdrawals NUMERIC;
  v_inv_gross_buy NUMERIC;
  v_inv_gross_sell NUMERIC;
  v_inv_commission NUMERIC;
  v_brokerage_rate NUMERIC;
  v_existing_count INTEGER;
BEGIN
  -- Check if EOD already exists for this date
  IF p_skip_existing THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date;
    
    IF v_existing_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', format('EOD for %s already exists (%s records), skipped', p_eod_date::text, v_existing_count)
      );
    END IF;
  END IF;

  -- Delete existing snapshots for this date (if not skipping)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  
  -- Get previous business day for opening balance
  v_prev_date := p_eod_date - INTERVAL '1 day';
  
  -- Convert p_eod_date to string format matching trade_history.trade_date (YYYYMMDD)
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  
  -- Get user email for audit
  SELECT COALESCE(auth.jwt() ->> 'email', 'system') INTO v_user_email;
  
  -- Count distinct trade files for this date
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_trade_date_str;
  
  -- Count deposit/withdrawal records for this date
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Build complete investor universe from multiple sources
  FOR v_investor IN
    SELECT DISTINCT inv_code, investor_name, brokerage_rate, ledger_balance as base_ledger
    FROM (
      -- Source 1: investors table (master list)
      SELECT UPPER(investor_code) as inv_code, investor_name, 
             COALESCE(brokerage_commission, 0) as brokerage_rate,
             COALESCE(ledger_balance, 0) as ledger_balance
      FROM investors
      WHERE investor_code IS NOT NULL
      
      UNION
      
      -- Source 2: clients table
      SELECT UPPER(inv_code) as inv_code, investor_name, 
             0 as brokerage_rate,
             COALESCE(ledger_balance, 0) as ledger_balance
      FROM clients
      WHERE inv_code IS NOT NULL
      
      UNION
      
      -- Source 3: trade_history for today
      SELECT UPPER(client_code) as inv_code, NULL as investor_name, 
             0 as brokerage_rate, 0 as ledger_balance
      FROM trade_history
      WHERE trade_date = v_trade_date_str
        AND client_code IS NOT NULL
      
      UNION
      
      -- Source 4: deposits_withdrawals for today
      SELECT UPPER(investor_code) as inv_code, investor_name, 
             0 as brokerage_rate, 0 as ledger_balance
      FROM deposits_withdrawals
      WHERE transaction_date = p_eod_date
        AND investor_code IS NOT NULL
      
      UNION
      
      -- Source 5: previous day snapshots
      SELECT investor_code as inv_code, investor_name, 
             COALESCE(brokerage_rate, 0) as brokerage_rate,
             COALESCE(closing_balance, 0) as ledger_balance
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
        AND investor_code IS NOT NULL
    ) all_investors
  LOOP
    -- Get brokerage rate from investors table if not already set
    IF v_investor.brokerage_rate = 0 OR v_investor.brokerage_rate IS NULL THEN
      SELECT COALESCE(brokerage_commission, 0) INTO v_brokerage_rate
      FROM investors
      WHERE UPPER(investor_code) = v_investor.inv_code
      LIMIT 1;
      
      IF v_brokerage_rate IS NULL THEN
        v_brokerage_rate := 0;
      END IF;
    ELSE
      v_brokerage_rate := v_investor.brokerage_rate;
    END IF;
    
    -- Get opening balance from previous day's closing or base ledger
    SELECT closing_balance INTO v_opening_balance
    FROM eod_ledger_snapshots
    WHERE investor_code = v_investor.inv_code
      AND eod_date = v_prev_date
    LIMIT 1;
    
    IF v_opening_balance IS NULL THEN
      -- Use base ledger balance from investors/clients table
      SELECT COALESCE(ledger_balance, 0) INTO v_opening_balance
      FROM investors
      WHERE UPPER(investor_code) = v_investor.inv_code
      LIMIT 1;
      
      IF v_opening_balance IS NULL THEN
        SELECT COALESCE(ledger_balance, 0) INTO v_opening_balance
        FROM clients
        WHERE UPPER(inv_code) = v_investor.inv_code
        LIMIT 1;
      END IF;
      
      IF v_opening_balance IS NULL THEN
        v_opening_balance := 0;
      END IF;
    END IF;
    
    -- Calculate deposits for this investor on this date
    SELECT COALESCE(SUM(amount), 0) INTO v_inv_deposits
    FROM deposits_withdrawals
    WHERE UPPER(investor_code) = v_investor.inv_code
      AND transaction_date = p_eod_date
      AND LOWER(transaction_type) = 'deposit';
    
    -- Calculate withdrawals for this investor on this date
    SELECT COALESCE(SUM(amount), 0) INTO v_inv_withdrawals
    FROM deposits_withdrawals
    WHERE UPPER(investor_code) = v_investor.inv_code
      AND transaction_date = p_eod_date
      AND LOWER(transaction_type) = 'withdrawal';
    
    -- Calculate gross buy (using 'side' column with 'B' for buy)
    SELECT COALESCE(SUM(value), 0) INTO v_inv_gross_buy
    FROM trade_history
    WHERE UPPER(client_code) = v_investor.inv_code
      AND trade_date = v_trade_date_str
      AND UPPER(side) = 'B';
    
    -- Calculate gross sell (using 'side' column with 'S' for sell)
    SELECT COALESCE(SUM(value), 0) INTO v_inv_gross_sell
    FROM trade_history
    WHERE UPPER(client_code) = v_investor.inv_code
      AND trade_date = v_trade_date_str
      AND UPPER(side) = 'S';
    
    -- Calculate commission: (buy_value + sell_value) * (rate / 100)
    v_inv_commission := (v_inv_gross_buy + v_inv_gross_sell) * (v_brokerage_rate / 100);
    
    -- Calculate closing balance using the formula:
    -- Closing = Opening + Deposits - Withdrawals + Gross Sell - Gross Buy - Commission
    v_closing_balance := v_opening_balance + v_inv_deposits - v_inv_withdrawals 
                        + v_inv_gross_sell - v_inv_gross_buy - v_inv_commission;
    
    -- Only insert if there's any activity or balance
    IF v_opening_balance != 0 OR v_inv_deposits != 0 OR v_inv_withdrawals != 0 
       OR v_inv_gross_buy != 0 OR v_inv_gross_sell != 0 THEN
      
      INSERT INTO eod_ledger_snapshots (
        eod_date,
        investor_code,
        investor_name,
        opening_balance,
        total_deposits,
        total_withdrawals,
        gross_buy,
        gross_sell,
        total_commission,
        brokerage_rate,
        closing_balance,
        ledger_balance,
        created_by
      ) VALUES (
        p_eod_date,
        v_investor.inv_code,
        COALESCE(v_investor.investor_name, 
          (SELECT investor_name FROM investors WHERE UPPER(investor_code) = v_investor.inv_code LIMIT 1),
          (SELECT investor_name FROM clients WHERE UPPER(inv_code) = v_investor.inv_code LIMIT 1)
        ),
        v_opening_balance,
        v_inv_deposits,
        v_inv_withdrawals,
        v_inv_gross_buy,
        v_inv_gross_sell,
        v_inv_commission,
        v_brokerage_rate,
        v_closing_balance,
        v_closing_balance,
        auth.uid()
      );
      
      v_clients_captured := v_clients_captured + 1;
      v_total_ledger_balance := v_total_ledger_balance + v_closing_balance;
      v_total_deposits := v_total_deposits + v_inv_deposits;
      v_total_withdrawals := v_total_withdrawals + v_inv_withdrawals;
      v_gross_buy := v_gross_buy + v_inv_gross_buy;
      v_gross_sell := v_gross_sell + v_inv_gross_sell;
      v_total_commission := v_total_commission + v_inv_commission;
    END IF;
  END LOOP;
  
  -- Insert run history record
  INSERT INTO eod_run_history (
    run_date,
    run_by,
    run_by_email,
    clients_captured,
    total_ledger_balance,
    trade_files_count,
    deposit_records_count,
    total_deposits,
    total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    status
  ) VALUES (
    p_eod_date,
    auth.uid(),
    v_user_email,
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'completed'
  )
  RETURNING id INTO v_run_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE,
    'eod_date', p_eod_date
  );
END;
$function$;