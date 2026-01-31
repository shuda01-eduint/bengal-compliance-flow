-- Update process_staged_trades to calculate commission from investors.brokerage_commission
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_trade_count INTEGER := 0;
  v_investor_count INTEGER := 0;
  v_total_investors INTEGER := 0;
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
  v_prev_date DATE;
BEGIN
  v_prev_date := p_trade_date - 1;

  -- Get TOTAL investors count
  SELECT COUNT(*) INTO v_total_investors FROM investors;

  -- Get trade statistics with CALCULATED commission from investors.brokerage_commission
  SELECT 
    COUNT(*),
    COUNT(DISTINCT t.investor_code),
    COALESCE(SUM(CASE WHEN t.side = 'B' THEN t.qty * t.price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.side = 'S' THEN t.qty * t.price ELSE 0 END), 0),
    -- Calculate commission: trade_value * normalized_rate
    COALESCE(SUM(
      t.qty * t.price * 
      CASE 
        WHEN i.brokerage_commission IS NULL THEN 0.004  -- Default 0.4%
        WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100  -- Treat as percentage
        ELSE i.brokerage_commission  -- Use as direct multiplier
      END
    ), 0)
  INTO v_trade_count, v_investor_count, v_gross_buy, v_gross_sell, v_total_commission
  FROM trade_file t
  LEFT JOIN investors i ON t.investor_code = i.investor_code
  WHERE t.trade_date = p_trade_date;

  -- Get deposit/withdrawal statistics for THIS DATE ONLY
  SELECT 
    COUNT(*) FILTER (WHERE UPPER(type) = 'DEPOSIT'),
    COUNT(*) FILTER (WHERE UPPER(type) IN ('WITHDRAW', 'WITHDRAWAL')),
    COALESCE(SUM(amount) FILTER (WHERE UPPER(type) = 'DEPOSIT'), 0),
    COALESCE(SUM(ABS(amount)) FILTER (WHERE UPPER(type) IN ('WITHDRAW', 'WITHDRAWAL')), 0)
  INTO v_deposit_count, v_withdrawal_count, v_total_deposits, v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Get instrument prices for the date
  SELECT COUNT(DISTINCT instrument)
  INTO v_instruments_priced
  FROM instrument_prices_eod
  WHERE trade_date = p_trade_date;

  -- Delete existing snapshots for this date
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;

  -- Create ledger snapshots with interest and equity calculations
  WITH baseline AS (
    SELECT 
      investor_code,
      COALESCE(ledger_balance, 0) as opening_balance,
      COALESCE(total_mv, 0) as portfolio_value,
      rm_id,
      rm_name,
      rm_email
    FROM balances_raw
    WHERE as_of_date = v_prev_date
  ),
  investor_config AS (
    SELECT 
      i.investor_code,
      i.investor_name,
      COALESCE(i.interest_rate, 0) as interest_rate,
      COALESCE(i.account_type, 'Cash') as account_type,
      -- Normalize brokerage commission rate
      CASE 
        WHEN i.brokerage_commission IS NULL THEN 0.004
        WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
        ELSE i.brokerage_commission
      END as brokerage_rate,
      i.department
    FROM investors i
  ),
  rm_info AS (
    SELECT DISTINCT ON (ira.investor_code)
      ira.investor_code,
      ira.rm_email,
      ira.rm_name,
      ira.department,
      e.employee_id as rm_id
    FROM investor_rm_assignments ira
    LEFT JOIN employees e ON LOWER(e.email) = LOWER(ira.rm_email)
    ORDER BY ira.investor_code, ira.percentage DESC
  ),
  trade_summary AS (
    -- Aggregate trades by investor with calculated commission
    SELECT 
      t.investor_code,
      COALESCE(SUM(CASE WHEN t.side = 'B' THEN t.qty * t.price ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN t.side = 'S' THEN t.qty * t.price ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(t.qty * t.price), 0) as total_turnover,
      -- Calculate commission per investor using their rate
      COALESCE(SUM(
        t.qty * t.price * 
        CASE 
          WHEN i.brokerage_commission IS NULL THEN 0.004
          WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
          ELSE i.brokerage_commission
        END
      ), 0) as trade_commission
    FROM trade_file t
    LEFT JOIN investors i ON t.investor_code = i.investor_code
    WHERE t.trade_date = p_trade_date
    GROUP BY t.investor_code
  ),
  cash_summary AS (
    SELECT 
      investor_code,
      COALESCE(SUM(amount) FILTER (WHERE UPPER(type) = 'DEPOSIT'), 0) as deposits,
      COALESCE(SUM(ABS(amount)) FILTER (WHERE UPPER(type) IN ('WITHDRAW', 'WITHDRAWAL')), 0) as withdrawals
    FROM cash_ledger_txn
    WHERE txn_date = p_trade_date
    GROUP BY investor_code
  ),
  prev_snapshots AS (
    SELECT investor_code, COALESCE(cumulative_interest, 0) as prev_cumulative
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  positions AS (
    SELECT 
      br.investor_code,
      COALESCE(SUM(br.total_mv), 0) as total_mv
    FROM balances_raw br
    WHERE br.as_of_date = v_prev_date
    GROUP BY br.investor_code
  ),
  computed AS (
    SELECT 
      COALESCE(b.investor_code, ic.investor_code) as investor_code,
      ic.investor_name,
      ic.account_type,
      ic.brokerage_rate,
      ic.interest_rate,
      COALESCE(rm.rm_id, b.rm_id) as rm_id,
      COALESCE(rm.rm_name, b.rm_name) as rm_name,
      COALESCE(rm.rm_email, b.rm_email) as rm_email,
      COALESCE(rm.department, ic.department) as department,
      COALESCE(b.opening_balance, 0) as opening_balance,
      COALESCE(ts.gross_buy, 0) as gross_buy,
      COALESCE(ts.gross_sell, 0) as gross_sell,
      COALESCE(ts.trade_commission, 0) as total_commission,
      COALESCE(cs.deposits, 0) as deposits,
      COALESCE(cs.withdrawals, 0) as withdrawals,
      COALESCE(p.total_mv, b.portfolio_value, 0) as portfolio_value,
      COALESCE(ps.prev_cumulative, 0) as prev_cumulative,
      -- Calculate closing balance: opening + deposits - withdrawals + sells - buys - commission
      COALESCE(b.opening_balance, 0) 
        + COALESCE(cs.deposits, 0) 
        - COALESCE(cs.withdrawals, 0)
        + COALESCE(ts.gross_sell, 0) 
        - COALESCE(ts.gross_buy, 0) 
        - COALESCE(ts.trade_commission, 0) as closing_balance
    FROM baseline b
    FULL OUTER JOIN investor_config ic ON b.investor_code = ic.investor_code
    LEFT JOIN rm_info rm ON COALESCE(b.investor_code, ic.investor_code) = rm.investor_code
    LEFT JOIN trade_summary ts ON COALESCE(b.investor_code, ic.investor_code) = ts.investor_code
    LEFT JOIN cash_summary cs ON COALESCE(b.investor_code, ic.investor_code) = cs.investor_code
    LEFT JOIN positions p ON COALESCE(b.investor_code, ic.investor_code) = p.investor_code
    LEFT JOIN prev_snapshots ps ON COALESCE(b.investor_code, ic.investor_code) = ps.investor_code
    WHERE COALESCE(b.investor_code, ic.investor_code) IS NOT NULL
  ),
  with_interest AS (
    SELECT 
      c.*,
      CASE 
        WHEN c.closing_balance < 0 AND c.interest_rate > 0 THEN
          ROUND((c.interest_rate / 365.0 / 100.0) * ABS(c.closing_balance), 2)
        ELSE 0
      END as daily_interest
    FROM computed c
  ),
  final_calc AS (
    SELECT 
      wi.*,
      wi.prev_cumulative + wi.daily_interest as cumulative_interest,
      wi.portfolio_value - ABS(LEAST(wi.closing_balance, 0)) - (wi.prev_cumulative + wi.daily_interest) as equity
    FROM with_interest wi
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    account_type,
    brokerage_rate,
    interest_rate,
    rm_id,
    rm_name,
    rm_email,
    department,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    closing_balance,
    ledger_balance,
    total_mv,
    accrued_interest,
    cumulative_interest
  )
  SELECT 
    p_trade_date,
    investor_code,
    investor_name,
    account_type,
    brokerage_rate,
    interest_rate,
    rm_id,
    rm_name,
    rm_email,
    department,
    opening_balance,
    gross_buy,
    gross_sell,
    total_commission,
    deposits,
    withdrawals,
    closing_balance,
    closing_balance,
    portfolio_value,
    daily_interest,
    cumulative_interest
  FROM final_calc;

  GET DIAGNOSTICS v_snapshots_created = ROW_COUNT;

  -- Calculate summary statistics
  SELECT 
    COUNT(*) FILTER (WHERE closing_balance < 0),
    COALESCE(SUM(ABS(closing_balance)) FILTER (WHERE closing_balance < 0), 0),
    COALESCE(SUM(accrued_interest), 0),
    COALESCE(SUM(cumulative_interest), 0),
    COALESCE(SUM(total_mv - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)), 0),
    COUNT(*) FILTER (WHERE (total_mv - ABS(LEAST(closing_balance, 0)) - COALESCE(cumulative_interest, 0)) < 0),
    COUNT(*) FILTER (WHERE rm_email IS NOT NULL),
    COUNT(*) FILTER (WHERE department IS NOT NULL)
  INTO 
    v_margin_accounts,
    v_margin_exposure,
    v_daily_interest_total,
    v_cumulative_interest_total,
    v_total_equity,
    v_negative_equity_count,
    v_with_rm_assigned,
    v_with_department
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  SELECT COALESCE(SUM(total_mv), 0)
  INTO v_total_market_value
  FROM eod_ledger_snapshots
  WHERE eod_date = p_trade_date;

  -- Create instrument position snapshots
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
    br.investor_code,
    br.instrument,
    COALESCE(br.total_stock, 0),
    COALESCE(br.saleable, 0),
    COALESCE(br.avg_cost, 0),
    COALESCE(br.total_cost, 0),
    COALESCE(
      br.total_stock * COALESCE(ip.eod_price, s.close_price, br.avg_cost),
      br.total_mv,
      0
    )
  FROM balances_raw br
  LEFT JOIN instrument_prices_eod ip ON br.instrument = ip.instrument AND ip.trade_date = p_trade_date
  LEFT JOIN securities s ON br.instrument = s.trading_code
  WHERE br.as_of_date = v_prev_date
    AND br.instrument IS NOT NULL
    AND br.total_stock > 0;

  GET DIAGNOSTICS v_positions_captured = ROW_COUNT;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_total_investors,
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

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;