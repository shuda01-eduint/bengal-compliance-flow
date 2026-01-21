-- Fix run_batch_eod performance + response shape (avoid HTTP 120s timeout)
-- Uses set-based aggregation (no per-investor queries) and correct BUY/SELL mapping.

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
AS $function$
DECLARE
  v_trade_date_str text;
  v_prev_date date;
  v_existing_count int := 0;

  v_clients_captured int := 0;
  v_total_ledger_balance numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count int := 0;
  v_deposit_records_count int := 0;

  v_run_id uuid;
BEGIN
  -- Security: admin-only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can run EOD';
  END IF;

  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_prev_date := p_eod_date - interval '1 day';

  SELECT COUNT(*)::int INTO v_existing_count
  FROM public.eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  IF v_existing_count > 0 AND p_skip_existing THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'message', format('EOD for %s already exists with %s snapshots', p_eod_date, v_existing_count),
      'clients_captured', v_existing_count,
      'eod_date', p_eod_date
    );
  END IF;

  -- Re-run: clear existing snapshots + history for the day
  IF v_existing_count > 0 THEN
    DELETE FROM public.eod_ledger_snapshots WHERE eod_date = p_eod_date;
    DELETE FROM public.eod_run_history WHERE run_date = p_eod_date;
  END IF;

  -- Basic counts for reporting
  SELECT COUNT(DISTINCT file_name)::int
  INTO v_trade_files_count
  FROM public.trade_history
  WHERE trade_date = v_trade_date_str;

  SELECT COUNT(*)::int
  INTO v_deposit_records_count
  FROM public.deposits_withdrawals
  WHERE transaction_date = p_eod_date;

  WITH
  inv AS (
    SELECT
      UPPER(i.investor_code) AS investor_code,
      i.investor_name,
      COALESCE(i.ledger_balance, 0) AS base_balance,
      COALESCE(i.brokerage_commission, 0.4) AS brokerage_commission_raw
    FROM public.investors i
    WHERE i.investor_code IS NOT NULL
  ),
  prev AS (
    SELECT UPPER(s.investor_code) AS investor_code, s.closing_balance
    FROM public.eod_ledger_snapshots s
    WHERE s.eod_date = v_prev_date
  ),
  tx AS (
    SELECT
      UPPER(d.investor_code) AS investor_code,
      SUM(CASE WHEN UPPER(d.transaction_type) = 'DEPOSIT' THEN d.amount ELSE 0 END) AS total_deposits,
      SUM(CASE WHEN UPPER(d.transaction_type) = 'WITHDRAWAL' THEN d.amount ELSE 0 END) AS total_withdrawals
    FROM public.deposits_withdrawals d
    WHERE d.transaction_date = p_eod_date
      AND d.investor_code IS NOT NULL
    GROUP BY UPPER(d.investor_code)
  ),
  trades AS (
    SELECT
      UPPER(t.client_code) AS investor_code,
      SUM(CASE WHEN UPPER(t.side) IN ('BUY','B') THEN t.value ELSE 0 END) AS gross_buy,
      SUM(CASE WHEN UPPER(t.side) IN ('SELL','S') THEN t.value ELSE 0 END) AS gross_sell,
      SUM(COALESCE(t.value, 0)) AS turnover
    FROM public.trade_history t
    WHERE t.trade_date = v_trade_date_str
      AND t.client_code IS NOT NULL
    GROUP BY UPPER(t.client_code)
  ),
  calc AS (
    SELECT
      inv.investor_code,
      inv.investor_name,
      COALESCE(prev.closing_balance, inv.base_balance) AS opening_balance,
      COALESCE(tx.total_deposits, 0) AS total_deposits,
      COALESCE(tx.total_withdrawals, 0) AS total_withdrawals,
      COALESCE(trades.gross_buy, 0) AS gross_buy,
      COALESCE(trades.gross_sell, 0) AS gross_sell,
      COALESCE(trades.turnover, 0) AS turnover,
      -- Normalize commission: values >= 0.1 are treated as percent (e.g. 0.4 => 0.004)
      CASE
        WHEN inv.brokerage_commission_raw IS NULL THEN 0.004
        WHEN inv.brokerage_commission_raw >= 0.1 THEN inv.brokerage_commission_raw / 100
        ELSE inv.brokerage_commission_raw
      END AS brokerage_rate
    FROM inv
    LEFT JOIN prev ON prev.investor_code = inv.investor_code
    LEFT JOIN tx ON tx.investor_code = inv.investor_code
    LEFT JOIN trades ON trades.investor_code = inv.investor_code
  ),
  final AS (
    SELECT
      c.*,
      (c.turnover * c.brokerage_rate) AS total_commission,
      (c.opening_balance + c.total_deposits - c.total_withdrawals + c.gross_sell - c.gross_buy - (c.turnover * c.brokerage_rate)) AS closing_balance
    FROM calc c
  ),
  inserted AS (
    INSERT INTO public.eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      opening_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      closing_balance,
      ledger_balance,
      brokerage_rate
    )
    SELECT
      p_eod_date,
      f.investor_code,
      f.investor_name,
      f.opening_balance,
      f.total_deposits,
      f.total_withdrawals,
      f.gross_buy,
      f.gross_sell,
      f.total_commission,
      f.closing_balance,
      f.closing_balance,
      f.brokerage_rate
    FROM final f
    RETURNING ledger_balance, gross_buy, gross_sell, total_commission, total_deposits, total_withdrawals
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(ledger_balance), 0),
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
  FROM inserted;

  INSERT INTO public.eod_run_history (
    run_date,
    run_at,
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
    now(),
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
    'completed'
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'run_id', v_run_id,
    'clients_captured', v_clients_captured,
    'total_ledger_balance', v_total_ledger_balance,
    'trade_files_count', v_trade_files_count,
    'deposit_records_count', v_deposit_records_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'eod_date', p_eod_date,
    'message', format('EOD completed for %s (%s snapshots)', p_eod_date, v_clients_captured)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'skipped', false,
    'eod_date', p_eod_date,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;
