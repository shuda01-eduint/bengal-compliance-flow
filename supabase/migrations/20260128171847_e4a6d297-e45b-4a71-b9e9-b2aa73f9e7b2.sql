
-- Optimized run_batch_eod function to complete within 90 seconds
-- Key optimizations:
-- 1. Single CTE for universe + delta calculations
-- 2. Pre-computed text date for trade_history comparisons
-- 3. Batched holdings snapshot insertion
-- 4. Reduced redundant subqueries

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $$
DECLARE
  v_clients_captured INTEGER := 0;
  v_total_ledger_balance NUMERIC := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_trade_files_count INTEGER := 0;
  v_deposit_records_count INTEGER := 0;
  v_existing_count INTEGER := 0;
  v_holdings_count INTEGER := 0;
  v_eod_date_text TEXT := TO_CHAR(p_eod_date, 'YYYYMMDD');
  v_prev_date_text TEXT := TO_CHAR(p_eod_date - INTERVAL '1 day', 'YYYYMMDD');
  v_prev_eod_date DATE := p_eod_date - INTERVAL '1 day';
BEGIN
  -- Security check
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin role required'
    );
  END IF;

  -- Check for existing EOD run
  IF p_skip_existing THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM eod_run_history
    WHERE run_date = p_eod_date AND status = 'completed';
    
    IF v_existing_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'message', 'EOD already exists for ' || p_eod_date::text
      );
    END IF;
  END IF;

  -- Delete existing snapshots for this date (if re-running)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;
  DELETE FROM eod_run_history WHERE run_date = p_eod_date;

  -- Get trade file count
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = v_eod_date_text;

  -- Get deposit/withdrawal count
  SELECT COUNT(*) INTO v_deposit_records_count
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  -- Main insert with optimized single-pass universe and delta calculation
  WITH 
  -- Previous day cumulative totals (single scan)
  prev_day_totals AS MATERIALIZED (
    SELECT 
      client_code,
      MAX(total_deposits) as prev_deposits,
      MAX(total_withdrawals) as prev_withdrawals,
      MAX(ledger_balance_snapshot) as prev_ledger_snapshot
    FROM trade_history
    WHERE trade_date = v_prev_date_text
    GROUP BY client_code
  ),
  -- Today's cumulative totals (single scan)
  today_totals AS MATERIALIZED (
    SELECT 
      client_code,
      MAX(total_deposits) as today_deposits,
      MAX(total_withdrawals) as today_withdrawals,
      MAX(ledger_balance_snapshot) as today_ledger_snapshot
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  -- Today's trade aggregates (single scan)
  today_trades AS MATERIALIZED (
    SELECT
      client_code,
      SUM(CASE WHEN side = 'B' OR side = 'BUY' THEN COALESCE(value, 0) ELSE 0 END) as gross_buy,
      SUM(CASE WHEN side = 'S' OR side = 'SELL' THEN COALESCE(value, 0) ELSE 0 END) as gross_sell,
      SUM(COALESCE(brokerage_commission, 0)) as total_commission,
      MAX(rm_id) as rm_id,
      MAX(rm_name) as rm_name,
      MAX(department) as department,
      MAX(account_type) as account_type,
      MAX(interest_rate) as interest_rate
    FROM trade_history
    WHERE trade_date = v_eod_date_text
    GROUP BY client_code
  ),
  -- Deposit/withdrawal deltas from deposits_withdrawals table
  dw_deltas AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  -- Build universe: all investors with any activity or prior balances
  universe AS MATERIALIZED (
    SELECT DISTINCT investor_code FROM (
      SELECT client_code as investor_code FROM today_trades
      UNION
      SELECT investor_code FROM dw_deltas
      UNION
      SELECT investor_code FROM investors
      UNION
      SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = v_prev_eod_date
    ) u
  ),
  -- Previous day closing balances
  prev_closing AS MATERIALIZED (
    SELECT investor_code, closing_balance
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_eod_date
  ),
  -- Investor master data
  inv_master AS MATERIALIZED (
    SELECT investor_code, investor_name, ledger_balance, rm_id, rm_name, department, account_type, interest_rate
    FROM investors
  ),
  -- Final calculation
  final_calc AS (
    SELECT
      u.investor_code,
      COALESCE(im.investor_name, '') as investor_name,
      -- Opening balance: previous closing or investors.ledger_balance or 0
      COALESCE(pc.closing_balance, im.ledger_balance, 0) as opening_balance,
      -- Daily deltas from trade_history cumulative differences
      COALESCE(tt.today_deposits, 0) - COALESCE(pdt.prev_deposits, 0) as th_deposits,
      COALESCE(tt.today_withdrawals, 0) - COALESCE(pdt.prev_withdrawals, 0) as th_withdrawals,
      -- Deltas from deposits_withdrawals table
      COALESCE(dw.deposits, 0) as dw_deposits,
      COALESCE(dw.withdrawals, 0) as dw_withdrawals,
      -- Trade values
      COALESCE(tr.gross_buy, 0) as gross_buy,
      COALESCE(tr.gross_sell, 0) as gross_sell,
      COALESCE(tr.total_commission, 0) as total_commission,
      -- Ledger snapshot from trade_history
      COALESCE(tt.today_ledger_snapshot, 0) as ledger_balance_snapshot,
      -- RM info (prioritize trade data, then investors)
      COALESCE(tr.rm_id, im.rm_id) as rm_id,
      COALESCE(tr.rm_name, im.rm_name) as rm_name,
      COALESCE(tr.department, im.department) as department,
      COALESCE(tr.account_type, im.account_type) as account_type,
      COALESCE(tr.interest_rate, im.interest_rate, 0) as interest_rate
    FROM universe u
    LEFT JOIN inv_master im ON im.investor_code = u.investor_code
    LEFT JOIN prev_closing pc ON pc.investor_code = u.investor_code
    LEFT JOIN prev_day_totals pdt ON pdt.client_code = u.investor_code
    LEFT JOIN today_totals tt ON tt.client_code = u.investor_code
    LEFT JOIN today_trades tr ON tr.client_code = u.investor_code
    LEFT JOIN dw_deltas dw ON dw.investor_code = u.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date, investor_code, investor_name, opening_balance, 
    total_deposits, total_withdrawals, gross_buy, gross_sell, total_commission,
    net_trade_value, closing_balance, ledger_balance, ledger_balance_snapshot,
    rm_id, rm_name, department, account_type, interest_rate, created_by
  )
  SELECT
    p_eod_date,
    investor_code,
    investor_name,
    opening_balance,
    -- Use deposits_withdrawals if available, else trade_history delta
    GREATEST(dw_deposits, th_deposits) as total_deposits,
    GREATEST(dw_withdrawals, th_withdrawals) as total_withdrawals,
    gross_buy,
    gross_sell,
    total_commission,
    gross_sell - gross_buy as net_trade_value,
    -- Closing = Opening + Deposits - Withdrawals + Sells - Buys - Commission
    opening_balance 
      + GREATEST(dw_deposits, th_deposits) 
      - GREATEST(dw_withdrawals, th_withdrawals)
      + gross_sell 
      - gross_buy 
      - total_commission as closing_balance,
    -- ledger_balance = closing_balance (for compatibility)
    opening_balance 
      + GREATEST(dw_deposits, th_deposits) 
      - GREATEST(dw_withdrawals, th_withdrawals)
      + gross_sell 
      - gross_buy 
      - total_commission as ledger_balance,
    ledger_balance_snapshot,
    rm_id,
    rm_name,
    department,
    account_type,
    interest_rate,
    auth.uid()
  FROM final_calc;

  -- Get counts and totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_clients_captured,
    v_total_ledger_balance,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Batch insert holdings snapshots (only for investors with actual holdings)
  INSERT INTO eod_holding_snapshots (
    eod_date, investor_code, security_code, total_qty, total_qty_saleable,
    avg_cost, total_cost, market_value
  )
  SELECT
    p_eod_date,
    h.investor_code,
    h.trading_code,
    COALESCE(h.total_stock, 0),
    COALESCE(h.saleable, 0),
    COALESCE(h.avg_cost, 0),
    COALESCE(h.total_cost, 0),
    COALESCE(h.market_value, 0)
  FROM holdings h
  WHERE h.total_stock > 0 OR h.saleable > 0;

  GET DIAGNOSTICS v_holdings_count = ROW_COUNT;

  -- Record run history
  INSERT INTO eod_run_history (
    run_date, run_by, run_by_email, clients_captured, total_ledger_balance,
    trade_files_count, deposit_records_count, total_deposits, total_withdrawals,
    gross_buy, gross_sell, total_commission, status
  )
  SELECT
    p_eod_date,
    auth.uid(),
    (auth.jwt() ->> 'email'),
    v_clients_captured,
    v_total_ledger_balance,
    v_trade_files_count,
    v_deposit_records_count,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    'completed';

  RETURN jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'holdings_captured', v_holdings_count,
    'total_ledger_balance', v_total_ledger_balance,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'eod_date', p_eod_date
  );
END;
$$;
