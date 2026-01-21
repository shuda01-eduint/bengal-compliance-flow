CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET statement_timeout TO '600s'
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
BEGIN
  -- Check if EOD already exists for this date and skip if requested
  IF p_skip_existing AND EXISTS (SELECT 1 FROM eod_snapshots WHERE snapshot_date = p_eod_date) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'run_date', p_eod_date,
      'message', 'EOD already exists for this date'
    );
  END IF;

  -- Delete existing EOD data for this date
  DELETE FROM eod_snapshots WHERE snapshot_date = p_eod_date;

  -- Calculate gross buy and gross sell totals
  SELECT 
    COALESCE(SUM(CASE WHEN UPPER(side) IN ('BUY', 'B') THEN COALESCE(value, quantity * price) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) IN ('SELL', 'S') THEN COALESCE(value, quantity * price) ELSE 0 END), 0)
  INTO v_gross_buy, v_gross_sell
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
    AND (status IN ('FILL', 'PF') OR fill_type IN ('FILL', 'PF'));

  -- Get trade file count for this date
  SELECT COUNT(DISTINCT source_file) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD');

  -- Get deposit/withdrawal stats
  SELECT 
    COUNT(*),
    COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0)
  INTO v_deposit_records_count, v_total_deposits, v_total_withdrawals
  FROM deposits_withdrawals
  WHERE effective_date = p_eod_date;

  -- Main EOD calculation with FULL OUTER JOIN to capture all investors
  WITH previous_day_eod AS (
    SELECT client_code, closing_ledger_balance
    FROM eod_snapshots
    WHERE snapshot_date = (
      SELECT MAX(snapshot_date) 
      FROM eod_snapshots 
      WHERE snapshot_date < p_eod_date
    )
  ),
  all_investors AS (
    SELECT DISTINCT client_code FROM (
      SELECT bo_id AS client_code FROM clients WHERE bo_id IS NOT NULL
      UNION
      SELECT client_code FROM previous_day_eod WHERE client_code IS NOT NULL
      UNION
      SELECT client_code FROM trade_history 
      WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD') 
        AND client_code IS NOT NULL
      UNION
      SELECT investor_code AS client_code FROM deposits_withdrawals 
      WHERE effective_date = p_eod_date 
        AND investor_code IS NOT NULL
    ) combined
  ),
  day_deposits AS (
    SELECT 
      investor_code AS client_code,
      COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM deposits_withdrawals
    WHERE effective_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      th.client_code,
      COALESCE(i.investor_name, c.client_name, th.client_code) AS investor_name,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('BUY', 'B') THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END), 0) AS total_buy,
      COALESCE(SUM(CASE WHEN UPPER(th.side) IN ('SELL', 'S') THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END), 0) AS total_sell,
      SUM(COALESCE(th.value, th.quantity * th.price) * (COALESCE(i.brokerage_commission, 0.4) / 100)) AS total_commission
    FROM trade_history th
    LEFT JOIN investors i ON th.client_code = i.investor_code
    LEFT JOIN clients c ON th.client_code = c.bo_id
    WHERE th.trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
      AND (th.status IN ('FILL', 'PF') OR th.fill_type IN ('FILL', 'PF'))
    GROUP BY th.client_code, i.investor_name, c.client_name
  ),
  eod_calc AS (
    SELECT 
      ai.client_code,
      COALESCE(dt.investor_name, i.investor_name, c.client_name, ai.client_code) AS investor_name,
      COALESCE(pe.closing_ledger_balance, 0) AS opening_balance,
      COALESCE(dd.total_deposits, 0) AS deposits,
      COALESCE(dd.total_withdrawals, 0) AS withdrawals,
      COALESCE(dt.total_buy, 0) AS gross_buy,
      COALESCE(dt.total_sell, 0) AS gross_sell,
      COALESCE(dt.total_commission, 0) AS commission,
      -- Net trades = Sell - Buy (selling adds to balance, buying subtracts)
      COALESCE(dt.total_sell, 0) - COALESCE(dt.total_buy, 0) AS net_trades,
      -- Closing = Opening + Deposits - Withdrawals + Net Trades - Commission
      COALESCE(pe.closing_ledger_balance, 0) 
        + COALESCE(dd.total_deposits, 0) 
        - COALESCE(dd.total_withdrawals, 0)
        + (COALESCE(dt.total_sell, 0) - COALESCE(dt.total_buy, 0))
        - COALESCE(dt.total_commission, 0) AS closing_balance
    FROM all_investors ai
    LEFT JOIN previous_day_eod pe ON ai.client_code = pe.client_code
    LEFT JOIN day_deposits dd ON ai.client_code = dd.client_code
    LEFT JOIN day_trades dt ON ai.client_code = dt.client_code
    LEFT JOIN investors i ON ai.client_code = i.investor_code
    LEFT JOIN clients c ON ai.client_code = c.bo_id
  )
  INSERT INTO eod_snapshots (
    snapshot_date,
    client_code,
    investor_name,
    opening_ledger_balance,
    deposits,
    withdrawals,
    gross_buy,
    gross_sell,
    commission,
    net_trades,
    closing_ledger_balance
  )
  SELECT 
    p_eod_date,
    client_code,
    investor_name,
    opening_balance,
    deposits,
    withdrawals,
    gross_buy,
    gross_sell,
    commission,
    net_trades,
    closing_balance
  FROM eod_calc;

  -- Get summary stats
  SELECT COUNT(*), COALESCE(SUM(closing_ledger_balance), 0)
  INTO v_clients_captured, v_total_ledger_balance
  FROM eod_snapshots
  WHERE snapshot_date = p_eod_date;

  RETURN jsonb_build_object(
    'success', true,
    'run_date', p_eod_date,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell
  );
END;
$function$;