CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_inserted_count integer;
  v_skipped_count integer := 0;
  v_prev_date date;
  v_error_message text;
  v_error_detail text;
BEGIN
  -- Calculate the previous business day
  v_prev_date := p_eod_date - interval '1 day';
  
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    SELECT COUNT(*) INTO v_skipped_count FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', 'EOD already exists for this date, skipped',
      'eod_date', p_eod_date,
      'clients_captured', v_skipped_count,
      'inserted_count', 0
    );
  END IF;
  
  -- Delete existing EOD data for this date if not skipping
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  
  -- Insert EOD snapshots for all investors from unified universe
  WITH all_investor_codes AS (
    -- From investors master table
    SELECT UPPER(investor_code) as inv_code FROM investors WHERE investor_code IS NOT NULL
    UNION
    -- From clients table (uses inv_code column)
    SELECT UPPER(inv_code) as inv_code FROM clients WHERE inv_code IS NOT NULL
    UNION
    -- From trade_history for current date
    SELECT UPPER(client_code) as inv_code FROM trade_history WHERE trade_date = p_eod_date AND client_code IS NOT NULL
    UNION
    -- From deposits_withdrawals for current date
    SELECT UPPER(investor_code) as inv_code FROM deposits_withdrawals WHERE transaction_date = p_eod_date AND investor_code IS NOT NULL
    UNION
    -- From previous day's EOD snapshots (chain continuity)
    SELECT UPPER(investor_code) as inv_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_date AND investor_code IS NOT NULL
  ),
  previous_eod AS (
    SELECT UPPER(investor_code) as investor_code, closing_balance, ledger_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  trades AS (
    SELECT 
      UPPER(client_code) as investor_code,
      SUM(CASE WHEN UPPER(buy_sell) = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(buy_sell) = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      COUNT(*) as trade_count
    FROM trade_history
    WHERE trade_date = p_eod_date
    GROUP BY UPPER(client_code)
  ),
  dep_wdraw AS (
    SELECT 
      UPPER(investor_code) as investor_code,
      SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN COALESCE(amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(type) = 'WITHDRAWAL' THEN COALESCE(amount, 0) ELSE 0 END) as withdrawals,
      COUNT(*) as tx_count
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY UPPER(investor_code)
  ),
  investor_info AS (
    SELECT 
      UPPER(investor_code) as investor_code,
      investor_name,
      COALESCE(ledger_balance, 0) as ledger_balance,
      COALESCE(brokerage_commission, 0) as brokerage_commission
    FROM investors
  ),
  client_info AS (
    SELECT 
      UPPER(inv_code) as investor_code,
      COALESCE(ledger_balance, 0) as ledger_balance
    FROM clients
  ),
  totals AS (
    SELECT 
      COALESCE(SUM(tr.gross_buy), 0) as total_gross_buy,
      COALESCE(SUM(tr.gross_sell), 0) as total_gross_sell,
      COALESCE(SUM(tr.trade_count), 0) as total_trade_count,
      COALESCE(SUM(dw.deposits), 0) as total_deposits,
      COALESCE(SUM(dw.withdrawals), 0) as total_withdrawals,
      COALESCE(SUM(dw.tx_count), 0) as total_tx_count
    FROM all_investor_codes aic
    LEFT JOIN trades tr ON tr.investor_code = aic.inv_code
    LEFT JOIN dep_wdraw dw ON dw.investor_code = aic.inv_code
  )
  INSERT INTO eod_ledger_snapshots (
    investor_code, eod_date, opening_balance, deposits, withdrawals,
    gross_buy, gross_sell, total_commission, closing_balance, ledger_balance
  )
  SELECT 
    aic.inv_code,
    p_eod_date,
    COALESCE(pe.closing_balance, pe.ledger_balance, inv.ledger_balance, cli.ledger_balance, 0) as opening_balance,
    COALESCE(dw.deposits, 0) as deposits,
    COALESCE(dw.withdrawals, 0) as withdrawals,
    COALESCE(tr.gross_buy, 0) as gross_buy,
    COALESCE(tr.gross_sell, 0) as gross_sell,
    (COALESCE(tr.gross_buy, 0) + COALESCE(tr.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0.4) / 100 as total_commission,
    -- closing_balance = opening + deposits - withdrawals + sells - buys - commission
    COALESCE(pe.closing_balance, pe.ledger_balance, inv.ledger_balance, cli.ledger_balance, 0) 
      + COALESCE(dw.deposits, 0) 
      - COALESCE(dw.withdrawals, 0)
      + COALESCE(tr.gross_sell, 0)
      - COALESCE(tr.gross_buy, 0)
      - ((COALESCE(tr.gross_buy, 0) + COALESCE(tr.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0.4) / 100) as closing_balance,
    -- ledger_balance is the same as closing_balance
    COALESCE(pe.closing_balance, pe.ledger_balance, inv.ledger_balance, cli.ledger_balance, 0) 
      + COALESCE(dw.deposits, 0) 
      - COALESCE(dw.withdrawals, 0)
      + COALESCE(tr.gross_sell, 0)
      - COALESCE(tr.gross_buy, 0)
      - ((COALESCE(tr.gross_buy, 0) + COALESCE(tr.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0.4) / 100) as ledger_balance
  FROM all_investor_codes aic
  LEFT JOIN previous_eod pe ON pe.investor_code = aic.inv_code
  LEFT JOIN trades tr ON tr.investor_code = aic.inv_code
  LEFT JOIN dep_wdraw dw ON dw.investor_code = aic.inv_code
  LEFT JOIN investor_info inv ON inv.investor_code = aic.inv_code
  LEFT JOIN client_info cli ON cli.investor_code = aic.inv_code;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- Return with aggregate totals
  RETURN (
    SELECT jsonb_build_object(
      'success', true,
      'skipped', false,
      'message', 'EOD batch completed successfully',
      'eod_date', p_eod_date,
      'clients_captured', v_inserted_count,
      'gross_buy', t.total_gross_buy,
      'gross_sell', t.total_gross_sell,
      'trade_files_count', t.total_trade_count,
      'deposit_records_count', t.total_tx_count,
      'total_deposits', t.total_deposits,
      'total_withdrawals', t.total_withdrawals
    )
    FROM (
      SELECT 
        COALESCE(SUM(gross_buy), 0) as total_gross_buy,
        COALESCE(SUM(gross_sell), 0) as total_gross_sell,
        COUNT(*) as total_trade_count,
        0 as total_tx_count,
        0 as total_deposits,
        0 as total_withdrawals
      FROM eod_ledger_snapshots WHERE eod_date = p_eod_date
    ) t
  );
  
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS 
    v_error_message = MESSAGE_TEXT,
    v_error_detail = PG_EXCEPTION_DETAIL;
  
  RETURN jsonb_build_object(
    'success', false,
    'message', v_error_message,
    'error', v_error_message,
    'error_detail', COALESCE(v_error_detail, ''),
    'eod_date', p_eod_date,
    'clients_captured', 0
  );
END;
$function$;