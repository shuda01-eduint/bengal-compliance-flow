CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result jsonb;
  v_inserted_count integer;
  v_skipped_count integer := 0;
  v_prev_date date;
BEGIN
  -- Calculate the previous business day
  v_prev_date := p_eod_date - interval '1 day';
  
  -- Check if EOD already exists for this date
  IF p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_snapshots WHERE eod_date = p_eod_date LIMIT 1
  ) THEN
    SELECT COUNT(*) INTO v_skipped_count FROM eod_snapshots WHERE eod_date = p_eod_date;
    RETURN jsonb_build_object(
      'success', true,
      'message', 'EOD already exists for this date, skipped',
      'eod_date', p_eod_date,
      'inserted_count', 0,
      'skipped_count', v_skipped_count
    );
  END IF;
  
  -- Delete existing EOD data for this date if not skipping
  DELETE FROM eod_snapshots WHERE eod_date = p_eod_date;
  
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
    SELECT UPPER(investor_code) as inv_code FROM eod_snapshots WHERE eod_date = v_prev_date AND investor_code IS NOT NULL
  ),
  previous_eod AS (
    SELECT UPPER(investor_code) as investor_code, closing_balance
    FROM eod_snapshots
    WHERE eod_date = v_prev_date
  ),
  trades AS (
    SELECT 
      UPPER(client_code) as investor_code,
      SUM(CASE WHEN UPPER(buy_sell) = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(buy_sell) = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell
    FROM trade_history
    WHERE trade_date = p_eod_date
    GROUP BY UPPER(client_code)
  ),
  dep_wdraw AS (
    SELECT 
      UPPER(investor_code) as investor_code,
      SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN COALESCE(amount, 0) ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(type) = 'WITHDRAWAL' THEN COALESCE(amount, 0) ELSE 0 END) as withdrawals
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
  holdings AS (
    SELECT 
      UPPER(investor_code) as investor_code,
      SUM(COALESCE(market_value, 0)) as total_market_value
    FROM investor_holdings
    WHERE as_of_date = p_eod_date
    GROUP BY UPPER(investor_code)
  )
  INSERT INTO eod_snapshots (
    investor_code, eod_date, opening_balance, deposits, withdrawals,
    gross_buy, gross_sell, total_commission, closing_balance,
    market_value, pending_buy, pending_sell, matured_balance,
    receivable_sale, cq_in_transit
  )
  SELECT 
    aic.inv_code,
    p_eod_date,
    COALESCE(pe.closing_balance, inv.ledger_balance, 0) as opening_balance,
    COALESCE(dw.deposits, 0) as deposits,
    COALESCE(dw.withdrawals, 0) as withdrawals,
    COALESCE(tr.gross_buy, 0) as gross_buy,
    COALESCE(tr.gross_sell, 0) as gross_sell,
    (COALESCE(tr.gross_buy, 0) + COALESCE(tr.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0.4) / 100 as total_commission,
    COALESCE(pe.closing_balance, inv.ledger_balance, 0) 
      + COALESCE(dw.deposits, 0) 
      - COALESCE(dw.withdrawals, 0)
      + COALESCE(tr.gross_sell, 0)
      - COALESCE(tr.gross_buy, 0)
      - ((COALESCE(tr.gross_buy, 0) + COALESCE(tr.gross_sell, 0)) * COALESCE(inv.brokerage_commission, 0.4) / 100) as closing_balance,
    COALESCE(hld.total_market_value, 0) as market_value,
    0 as pending_buy,
    0 as pending_sell,
    0 as matured_balance,
    0 as receivable_sale,
    0 as cq_in_transit
  FROM all_investor_codes aic
  LEFT JOIN previous_eod pe ON pe.investor_code = aic.inv_code
  LEFT JOIN trades tr ON tr.investor_code = aic.inv_code
  LEFT JOIN dep_wdraw dw ON dw.investor_code = aic.inv_code
  LEFT JOIN investor_info inv ON inv.investor_code = aic.inv_code
  LEFT JOIN holdings hld ON hld.investor_code = aic.inv_code;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'EOD batch completed successfully',
    'eod_date', p_eod_date,
    'inserted_count', v_inserted_count,
    'skipped_count', 0
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'eod_date', p_eod_date,
    'inserted_count', 0,
    'skipped_count', 0
  );
END;
$function$;