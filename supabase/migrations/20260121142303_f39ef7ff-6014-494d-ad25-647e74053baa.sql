-- Update run_batch_eod to use ledger_balance as fallback for opening balance from baseline imports
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  v_result jsonb;
  v_prev_date date;
  v_total_investors int := 0;
  v_total_trades int := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_total_gross_buy numeric := 0;
  v_total_gross_sell numeric := 0;
  v_date_str text;
BEGIN
  -- Check if we should skip this date
  IF p_skip_existing THEN
    IF EXISTS (SELECT 1 FROM eod_ledger_snapshots WHERE eod_date = p_eod_date LIMIT 1) THEN
      RETURN jsonb_build_object(
        'success', true,
        'skipped', true,
        'eod_date', p_eod_date,
        'message', 'EOD already exists for this date'
      );
    END IF;
  END IF;

  -- Find the previous business day with EOD data
  SELECT MAX(eod_date) INTO v_prev_date
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date;

  -- Format date for trade_history matching
  v_date_str := to_char(p_eod_date, 'YYYYMMDD');

  -- Delete existing EOD data for this date if not skipping
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;

  -- Insert EOD snapshots for all investors with cascading balance calculation
  -- Uses FULL OUTER JOIN across previous EOD, clients table, and investors master
  -- Opening balance priority: previous closing_balance -> previous ledger_balance -> clients.ledger_balance -> 0
  WITH all_investors AS (
    -- Get all unique investor codes from three sources
    SELECT DISTINCT inv_code, inv_opening
    FROM (
      -- Source 1: Previous day EOD snapshots (use closing_balance, fallback to ledger_balance for baseline)
      SELECT 
        investor_code as inv_code,
        COALESCE(
          NULLIF(closing_balance, 0),  -- Use closing_balance if non-zero
          ledger_balance,               -- Fallback to ledger_balance (for baseline imports)
          0
        ) as inv_opening
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
      
      UNION ALL
      
      -- Source 2: Clients table (current balances)
      SELECT 
        client_code as inv_code,
        COALESCE(ledger_balance, 0) as inv_opening
      FROM clients
      WHERE client_code IS NOT NULL
      
      UNION ALL
      
      -- Source 3: Investors master table
      SELECT 
        investor_code as inv_code,
        0 as inv_opening
      FROM investors
      WHERE investor_code IS NOT NULL
    ) combined
  ),
  prioritized_investors AS (
    -- Use DISTINCT ON to get one row per investor with priority:
    -- 1. Previous EOD (has actual calculated balance or baseline ledger_balance)
    -- 2. Clients table (has current ledger balance)
    -- 3. Investors master (defaults to 0)
    SELECT DISTINCT ON (inv_code) 
      inv_code,
      inv_opening
    FROM all_investors
    WHERE inv_code IS NOT NULL
    ORDER BY inv_code, inv_opening DESC NULLS LAST
  ),
  day_trades AS (
    -- Get all trades for the EOD date
    SELECT 
      th.client_code,
      th.side,
      COALESCE(th.value, th.quantity * th.price) as trade_value,
      th.quantity,
      th.price,
      -- Get commission rate: from trade_history or fallback to investors table
      COALESCE(
        th.brokerage_commission,
        i.brokerage_commission,
        0.4
      ) / 100.0 as commission_rate
    FROM trade_history th
    LEFT JOIN investors i ON th.client_code = i.investor_code
    WHERE th.trade_date = v_date_str
      AND UPPER(COALESCE(th.status, th.fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
  ),
  investor_trades AS (
    -- Aggregate trades per investor
    SELECT 
      client_code as inv_code,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'B' THEN trade_value ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'S' THEN trade_value ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'B' THEN trade_value * commission_rate ELSE 0 END), 0) as buy_commission,
      COALESCE(SUM(CASE WHEN UPPER(side) = 'S' THEN trade_value * commission_rate ELSE 0 END), 0) as sell_commission,
      COUNT(*) as trade_count
    FROM day_trades
    GROUP BY client_code
  ),
  investor_transactions AS (
    -- Aggregate deposits/withdrawals per investor
    SELECT 
      investor_code as inv_code,
      COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN COALESCE(amount, 0) ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN COALESCE(amount, 0) ELSE 0 END), 0) as withdrawals
    FROM investor_transactions
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  calculated_balances AS (
    SELECT 
      pi.inv_code,
      pi.inv_opening as opening_balance,
      COALESCE(it.deposits, 0) as total_deposits,
      COALESCE(it.withdrawals, 0) as total_withdrawals,
      COALESCE(tr.gross_buy, 0) as gross_buy,
      COALESCE(tr.gross_sell, 0) as gross_sell,
      COALESCE(tr.buy_commission, 0) + COALESCE(tr.sell_commission, 0) as total_commission,
      -- Net trade value: (gross_sell - sell_commission) - (gross_buy + buy_commission)
      (COALESCE(tr.gross_sell, 0) - COALESCE(tr.sell_commission, 0)) - 
      (COALESCE(tr.gross_buy, 0) + COALESCE(tr.buy_commission, 0)) as net_trade_value,
      -- Closing balance formula:
      -- opening + deposits - withdrawals + (gross_sell - sell_commission) - (gross_buy + buy_commission)
      pi.inv_opening 
        + COALESCE(it.deposits, 0) 
        - COALESCE(it.withdrawals, 0)
        + (COALESCE(tr.gross_sell, 0) - COALESCE(tr.sell_commission, 0))
        - (COALESCE(tr.gross_buy, 0) + COALESCE(tr.buy_commission, 0)) as closing_balance,
      COALESCE(tr.trade_count, 0) as trade_count
    FROM prioritized_investors pi
    LEFT JOIN investor_trades tr ON pi.inv_code = tr.inv_code
    LEFT JOIN investor_transactions it ON pi.inv_code = it.inv_code
  )
  INSERT INTO eod_ledger_snapshots (
    investor_code,
    eod_date,
    ledger_balance,
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value
  )
  SELECT 
    inv_code,
    p_eod_date,
    closing_balance,  -- ledger_balance = closing_balance for new records
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    total_deposits,
    total_withdrawals,
    total_commission,
    net_trade_value
  FROM calculated_balances;

  -- Get totals for the result
  SELECT 
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(total_deposits), 0),
    COALESCE(SUM(total_withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0)
  INTO v_total_investors, v_total_deposits, v_total_withdrawals, v_total_gross_buy, v_total_gross_sell
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  SELECT COUNT(*) INTO v_total_trades
  FROM trade_history
  WHERE trade_date = v_date_str
    AND UPPER(COALESCE(status, fill_type, '')) IN ('FILL', 'PF', 'FILLED', 'PARTIAL');

  -- Upsert into eod_run_history
  INSERT INTO eod_run_history (eod_date, total_investors, total_trades, total_deposits, total_withdrawals)
  VALUES (p_eod_date, v_total_investors, v_total_trades, v_total_deposits, v_total_withdrawals)
  ON CONFLICT (eod_date) DO UPDATE SET
    total_investors = EXCLUDED.total_investors,
    total_trades = EXCLUDED.total_trades,
    total_deposits = EXCLUDED.total_deposits,
    total_withdrawals = EXCLUDED.total_withdrawals,
    run_at = now();

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'previous_eod_date', v_prev_date,
    'total_investors', v_total_investors,
    'total_trades', v_total_trades,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_total_gross_buy,
    'gross_sell', v_total_gross_sell
  );

  RETURN v_result;
END;
$$;