-- Create process_staged_trades function
-- Processes trade_file + cash_ledger_txn for a given date
-- Uses balances_raw from previous day as opening baseline
-- Calculates interest, equity, and captures RM/department

CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_baseline_date DATE;
  v_trade_count INTEGER := 0;
  v_investor_count INTEGER := 0;
  v_gross_buy NUMERIC := 0;
  v_gross_sell NUMERIC := 0;
  v_total_commission NUMERIC := 0;
  v_deposit_count INTEGER := 0;
  v_withdrawal_count INTEGER := 0;
  v_total_deposits NUMERIC := 0;
  v_total_withdrawals NUMERIC := 0;
  v_instruments_priced INTEGER := 0;
  v_positions_captured INTEGER := 0;
  v_total_market_value NUMERIC := 0;
  v_snapshots_created INTEGER := 0;
  v_margin_accounts INTEGER := 0;
  v_margin_exposure NUMERIC := 0;
  v_daily_interest_total NUMERIC := 0;
  v_cumulative_interest_total NUMERIC := 0;
  v_total_equity NUMERIC := 0;
  v_negative_equity_count INTEGER := 0;
  v_with_rm_assigned INTEGER := 0;
  v_with_department INTEGER := 0;
BEGIN
  -- Check admin permission
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Calculate baseline date (previous trading day)
  v_baseline_date := p_trade_date - 1;

  -- Check if baseline data exists
  IF NOT EXISTS (SELECT 1 FROM balances_raw WHERE as_of_date = v_baseline_date LIMIT 1) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', format('No baseline data found for %s', v_baseline_date)
    );
  END IF;

  -- Delete existing snapshots for this date (idempotent)
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;

  -- Capture closing prices from securities master
  INSERT INTO instrument_prices_eod (trade_date, instrument, eod_price)
  SELECT p_trade_date, s.trading_code, s.close_price
  FROM securities s
  WHERE s.close_price IS NOT NULL AND s.close_price > 0
  ON CONFLICT (trade_date, instrument) 
  DO UPDATE SET eod_price = EXCLUDED.eod_price;

  GET DIAGNOSTICS v_instruments_priced = ROW_COUNT;

  -- Main processing with CTEs
  WITH 
  -- Get baseline ledger balances (deduplicated by investor)
  baseline AS MATERIALIZED (
    SELECT DISTINCT ON (b.investor_code)
      b.investor_code,
      b.rm_id,
      b.rm_name,
      COALESCE(e.email, ira.rm_email) as rm_email,
      COALESCE(e.department, i.department) as department,
      b.ledger_balance as opening_balance,
      b.matured_balance,
      b.receivable_sale,
      b.cq_in_transit,
      b.total_mv as baseline_mv,
      b.total_cost as baseline_cost,
      b.total_stock as baseline_stock,
      b.saleable as baseline_saleable,
      i.investor_name,
      i.interest_rate,
      i.account_type,
      i.brokerage_commission
    FROM balances_raw b
    LEFT JOIN employees e ON b.rm_id = e.employee_id
    LEFT JOIN investors i ON b.investor_code = i.investor_code
    LEFT JOIN (
      SELECT DISTINCT ON (investor_code) investor_code, rm_email
      FROM investor_rm_assignments
      ORDER BY investor_code, percentage DESC
    ) ira ON b.investor_code = ira.investor_code
    WHERE b.as_of_date = v_baseline_date
    ORDER BY b.investor_code
  ),

  -- Aggregate trades for the day
  today_trades AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN UPPER(side) = 'BUY' THEN qty * price ELSE 0 END) as gross_buy,
      SUM(CASE WHEN UPPER(side) = 'SELL' THEN qty * price ELSE 0 END) as gross_sell,
      SUM(COALESCE(commission, 0)) as total_commission,
      COUNT(*) as trade_count
    FROM trade_file
    WHERE trade_date = p_trade_date
    GROUP BY investor_code
  ),

  -- Aggregate cash transactions
  cash_txns AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN UPPER(type) = 'WITHDRAW' OR UPPER(type) = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals,
      COUNT(CASE WHEN UPPER(type) = 'DEPOSIT' THEN 1 END) as deposit_count,
      COUNT(CASE WHEN UPPER(type) = 'WITHDRAW' OR UPPER(type) = 'WITHDRAWAL' THEN 1 END) as withdrawal_count
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  ),

  -- Get previous cumulative interest (for chained runs)
  prev_snapshots AS MATERIALIZED (
    SELECT investor_code, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = v_baseline_date
  ),

  -- Calculate position summaries per investor
  position_summary AS MATERIALIZED (
    SELECT
      b.investor_code,
      SUM(COALESCE(b.total_stock, 0)) as total_stock,
      SUM(COALESCE(b.saleable, 0)) as saleable,
      SUM(COALESCE(b.total_cost, 0)) as total_cost,
      SUM(COALESCE(b.total_stock, 0) * COALESCE(pr.eod_price, b.avg_cost, 0)) as total_mv
    FROM balances_raw b
    LEFT JOIN instrument_prices_eod pr 
      ON pr.instrument = b.instrument AND pr.trade_date = p_trade_date
    WHERE b.as_of_date = v_baseline_date
    GROUP BY b.investor_code
  ),

  -- Combine all data and calculate closing balance, interest, equity
  combined AS (
    SELECT
      base.investor_code,
      base.investor_name,
      base.rm_id,
      base.rm_name,
      base.rm_email,
      base.department,
      base.opening_balance,
      base.matured_balance,
      base.receivable_sale,
      base.cq_in_transit,
      COALESCE(base.interest_rate, 0) as interest_rate,
      base.account_type,
      COALESCE(base.brokerage_commission, 0) as brokerage_rate,
      COALESCE(t.gross_buy, 0) as gross_buy,
      COALESCE(t.gross_sell, 0) as gross_sell,
      COALESCE(t.total_commission, 0) as total_commission,
      COALESCE(c.deposits, 0) as total_deposits,
      COALESCE(c.withdrawals, 0) as total_withdrawals,
      COALESCE(pos.total_stock, 0) as total_stock,
      COALESCE(pos.saleable, 0) as saleable,
      COALESCE(pos.total_cost, 0) as total_cost,
      COALESCE(pos.total_mv, 0) as total_mv,
      -- Calculate closing balance
      COALESCE(base.opening_balance, 0) 
        + COALESCE(c.deposits, 0) 
        - COALESCE(c.withdrawals, 0)
        + COALESCE(t.gross_sell, 0) 
        - COALESCE(t.gross_buy, 0) 
        - COALESCE(t.total_commission, 0) as closing_balance,
      COALESCE(prev.cumulative_interest, 0) as prev_cumulative_interest
    FROM baseline base
    LEFT JOIN today_trades t ON base.investor_code = t.investor_code
    LEFT JOIN cash_txns c ON base.investor_code = c.investor_code
    LEFT JOIN position_summary pos ON base.investor_code = pos.investor_code
    LEFT JOIN prev_snapshots prev ON base.investor_code = prev.investor_code
  ),

  -- Calculate interest and equity
  final_calc AS (
    SELECT
      c.*,
      -- Daily accrued interest (only for negative balances with interest rate > 0)
      CASE 
        WHEN c.closing_balance < 0 AND c.interest_rate > 0 THEN
          ROUND((c.interest_rate / 365.0 / 100.0) * ABS(c.closing_balance), 2)
        ELSE 0
      END as accrued_interest,
      -- Cumulative interest
      c.prev_cumulative_interest + 
        CASE 
          WHEN c.closing_balance < 0 AND c.interest_rate > 0 THEN
            ROUND((c.interest_rate / 365.0 / 100.0) * ABS(c.closing_balance), 2)
          ELSE 0
        END as cumulative_interest,
      -- Equity = portfolio value - loan amount - cumulative interest
      c.total_mv 
        - ABS(LEAST(c.closing_balance, 0)) 
        - (c.prev_cumulative_interest + 
            CASE 
              WHEN c.closing_balance < 0 AND c.interest_rate > 0 THEN
                ROUND((c.interest_rate / 365.0 / 100.0) * ABS(c.closing_balance), 2)
              ELSE 0
            END) as equity
    FROM combined c
  ),

  -- Insert into eod_ledger_snapshots
  inserted AS (
    INSERT INTO eod_ledger_snapshots (
      eod_date,
      investor_code,
      investor_name,
      rm_id,
      rm_name,
      rm_email,
      department,
      opening_balance,
      closing_balance,
      ledger_balance,
      gross_buy,
      gross_sell,
      total_commission,
      total_deposits,
      total_withdrawals,
      total_stock,
      saleable,
      total_cost,
      total_mv,
      matured_balance,
      receivable_sale,
      cq_in_transit,
      interest_rate,
      accrued_interest,
      cumulative_interest,
      account_type,
      brokerage_rate,
      created_by
    )
    SELECT
      p_trade_date,
      f.investor_code,
      f.investor_name,
      f.rm_id,
      f.rm_name,
      f.rm_email,
      f.department,
      f.opening_balance,
      f.closing_balance,
      f.closing_balance, -- ledger_balance same as closing
      f.gross_buy,
      f.gross_sell,
      f.total_commission,
      f.total_deposits,
      f.total_withdrawals,
      f.total_stock,
      f.saleable,
      f.total_cost,
      f.total_mv,
      f.matured_balance,
      f.receivable_sale,
      f.cq_in_transit,
      f.interest_rate,
      f.accrued_interest,
      f.cumulative_interest,
      f.account_type,
      f.brokerage_rate,
      auth.uid()
    FROM final_calc f
    RETURNING 
      investor_code, 
      closing_balance, 
      accrued_interest, 
      cumulative_interest,
      total_mv,
      rm_id,
      department,
      total_mv - ABS(LEAST(closing_balance, 0)) - cumulative_interest as equity
  )
  -- Collect statistics
  SELECT 
    COUNT(*),
    COUNT(CASE WHEN closing_balance < 0 THEN 1 END),
    SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END),
    SUM(accrued_interest),
    SUM(cumulative_interest),
    SUM(total_mv),
    SUM(equity),
    COUNT(CASE WHEN equity < 0 THEN 1 END),
    COUNT(CASE WHEN rm_id IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN department IS NOT NULL THEN 1 END)
  INTO 
    v_snapshots_created,
    v_margin_accounts,
    v_margin_exposure,
    v_daily_interest_total,
    v_cumulative_interest_total,
    v_total_market_value,
    v_total_equity,
    v_negative_equity_count,
    v_with_rm_assigned,
    v_with_department
  FROM inserted;

  -- Insert position snapshots
  INSERT INTO eod_instrument_position (
    trade_date, 
    investor_code, 
    instrument,
    total_stock, 
    saleable, 
    avg_cost, 
    total_cost, 
    total_market_value
  )
  SELECT 
    p_trade_date,
    b.investor_code,
    b.instrument,
    COALESCE(b.total_stock, 0),
    COALESCE(b.saleable, 0),
    COALESCE(b.avg_cost, 0),
    COALESCE(b.total_cost, 0),
    COALESCE(b.total_stock, 0) * COALESCE(pr.eod_price, b.avg_cost, 0)
  FROM balances_raw b
  LEFT JOIN instrument_prices_eod pr 
    ON pr.instrument = b.instrument AND pr.trade_date = p_trade_date
  WHERE b.as_of_date = v_baseline_date
    AND b.instrument IS NOT NULL;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Get trade statistics
  SELECT 
    COUNT(*),
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(commission), 0)
  INTO 
    v_trade_count,
    v_investor_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Get cash transaction statistics
  SELECT 
    COUNT(CASE WHEN UPPER(type) = 'DEPOSIT' THEN 1 END),
    COUNT(CASE WHEN UPPER(type) = 'WITHDRAW' OR UPPER(type) = 'WITHDRAWAL' THEN 1 END),
    COALESCE(SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(type) = 'WITHDRAW' OR UPPER(type) = 'WITHDRAWAL' THEN amount ELSE 0 END), 0)
  INTO 
    v_deposit_count,
    v_withdrawal_count,
    v_total_deposits,
    v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  RETURN jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_investor_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'deposit_count', v_deposit_count,
    'withdrawal_count', v_withdrawal_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'instruments_priced', v_instruments_priced,
    'positions_captured', v_positions_captured,
    'total_market_value', v_total_market_value,
    'snapshots_created', v_snapshots_created,
    'margin_accounts', v_margin_accounts,
    'margin_exposure', v_margin_exposure,
    'daily_interest_total', v_daily_interest_total,
    'cumulative_interest_total', v_cumulative_interest_total,
    'total_equity', v_total_equity,
    'negative_equity_count', v_negative_equity_count,
    'with_rm_assigned', v_with_rm_assigned,
    'with_department', v_with_department
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.process_staged_trades(DATE) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.process_staged_trades IS 
'Process staged trades for a given date. Uses balances_raw as baseline, processes trade_file and cash_ledger_txn, calculates interest and equity, and creates EOD snapshots.';