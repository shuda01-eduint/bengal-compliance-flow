
-- Fix column name mismatch: clients table uses 'inv_code', not 'investor_code'
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_clients_processed int := 0;
  v_total_ledger numeric := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_trade_files_count int := 0;
  v_prev_date date;
BEGIN
  -- Get previous business day
  v_prev_date := p_eod_date - 1;

  -- Get trade files count for the day
  SELECT COUNT(DISTINCT file_name) INTO v_trade_files_count
  FROM trade_history
  WHERE trade_date = p_eod_date;

  -- Main insert with all calculations
  WITH prev_day AS (
    SELECT investor_code, closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = v_prev_date
  ),
  -- FIXED: Use inv_code from clients table, aliased as investor_code
  all_investors AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM prev_day
      UNION
      SELECT inv_code AS investor_code FROM clients WHERE inv_code IS NOT NULL
      UNION
      SELECT investor_code FROM investors WHERE investor_code IS NOT NULL
    ) combined
  ),
  base_balances AS (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      ledger_balance,
      total_stock,
      saleable,
      total_mv,
      total_cost,
      avg_cost,
      matured_balance,
      receivable_sale,
      cq_in_transit
    FROM balances_raw
    WHERE as_of_date <= p_eod_date
    ORDER BY investor_code, as_of_date DESC
  ),
  investor_rates AS (
    SELECT 
      investor_code,
      account_type,
      COALESCE(interest_rate, 0) as interest_rate,
      COALESCE(brokerage_commission, 0) as brokerage_rate
    FROM investors
  ),
  day_transactions AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  day_trades AS (
    SELECT 
      th.client_code as investor_code,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'B' THEN COALESCE(th.value, 0) ELSE 0 END) as buy_value,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'S' THEN COALESCE(th.value, 0) ELSE 0 END) as sell_value,
      SUM(COALESCE(th.value, 0) * COALESCE(ir.brokerage_rate, 0) / 100) as commission
    FROM trade_history th
    LEFT JOIN investor_rates ir ON th.client_code = ir.investor_code
    WHERE th.trade_date = p_eod_date
    GROUP BY th.client_code
  ),
  pending_settlements AS (
    SELECT 
      th.client_code as investor_code,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'B' THEN COALESCE(th.value, 0) ELSE 0 END) as pending_buy,
      SUM(CASE WHEN UPPER(th.buy_sell) = 'S' THEN COALESCE(th.value, 0) ELSE 0 END) as pending_sell
    FROM trade_history th
    WHERE th.trade_date > p_eod_date - 2 
      AND th.trade_date <= p_eod_date
    GROUP BY th.client_code
  ),
  calculated AS (
    SELECT 
      ai.investor_code,
      p_eod_date as eod_date,
      COALESCE(pd.closing_balance, bb.ledger_balance, 0) as opening_balance,
      COALESCE(dt.deposits, 0) as deposits,
      COALESCE(dt.withdrawals, 0) as withdrawals,
      COALESCE(tr.sell_value, 0) as gross_sell,
      COALESCE(tr.buy_value, 0) as gross_buy,
      COALESCE(tr.commission, 0) as total_commission,
      -- Closing balance calculation
      COALESCE(pd.closing_balance, bb.ledger_balance, 0) 
        + COALESCE(dt.deposits, 0) 
        - COALESCE(dt.withdrawals, 0) 
        + COALESCE(tr.sell_value, 0) 
        - COALESCE(tr.buy_value, 0) 
        - COALESCE(tr.commission, 0) as closing_balance,
      -- Position data from balances_raw
      COALESCE(bb.total_stock, 0) as total_stock,
      COALESCE(bb.saleable, 0) as saleable,
      COALESCE(ps.pending_buy, 0) as pending_buy,
      COALESCE(ps.pending_sell, 0) as pending_sell,
      COALESCE(bb.total_mv, 0) as total_mv,
      COALESCE(bb.total_cost, 0) as total_cost,
      COALESCE(bb.avg_cost, 0) as avg_cost,
      COALESCE(bb.total_mv, 0) - COALESCE(bb.total_cost, 0) as unrealized_pnl,
      COALESCE(bb.matured_balance, 0) as matured_balance,
      COALESCE(bb.receivable_sale, 0) as receivable_sale,
      COALESCE(bb.cq_in_transit, 0) as cq_in_transit,
      -- Interest calculation for margin accounts
      CASE 
        WHEN LOWER(ir.account_type) = 'margin' AND 
             (COALESCE(pd.closing_balance, bb.ledger_balance, 0) 
              + COALESCE(dt.deposits, 0) 
              - COALESCE(dt.withdrawals, 0) 
              + COALESCE(tr.sell_value, 0) 
              - COALESCE(tr.buy_value, 0) 
              - COALESCE(tr.commission, 0)) < 0
        THEN ABS(COALESCE(pd.closing_balance, bb.ledger_balance, 0) 
              + COALESCE(dt.deposits, 0) 
              - COALESCE(dt.withdrawals, 0) 
              + COALESCE(tr.sell_value, 0) 
              - COALESCE(tr.buy_value, 0) 
              - COALESCE(tr.commission, 0)) * COALESCE(ir.interest_rate, 0) / 100 / 365
        ELSE 0
      END as accrued_interest,
      COALESCE(pd.cumulative_interest, 0) + 
        CASE 
          WHEN LOWER(ir.account_type) = 'margin' AND 
               (COALESCE(pd.closing_balance, bb.ledger_balance, 0) 
                + COALESCE(dt.deposits, 0) 
                - COALESCE(dt.withdrawals, 0) 
                + COALESCE(tr.sell_value, 0) 
                - COALESCE(tr.buy_value, 0) 
                - COALESCE(tr.commission, 0)) < 0
          THEN ABS(COALESCE(pd.closing_balance, bb.ledger_balance, 0) 
                + COALESCE(dt.deposits, 0) 
                - COALESCE(dt.withdrawals, 0) 
                + COALESCE(tr.sell_value, 0) 
                - COALESCE(tr.buy_value, 0) 
                - COALESCE(tr.commission, 0)) * COALESCE(ir.interest_rate, 0) / 100 / 365
          ELSE 0
        END as cumulative_interest,
      ir.account_type,
      COALESCE(ir.interest_rate, 0) as interest_rate,
      COALESCE(ir.brokerage_rate, 0) as brokerage_rate
    FROM all_investors ai
    LEFT JOIN prev_day pd ON ai.investor_code = pd.investor_code
    LEFT JOIN base_balances bb ON ai.investor_code = bb.investor_code
    LEFT JOIN investor_rates ir ON ai.investor_code = ir.investor_code
    LEFT JOIN day_transactions dt ON ai.investor_code = dt.investor_code
    LEFT JOIN day_trades tr ON ai.investor_code = tr.investor_code
    LEFT JOIN pending_settlements ps ON ai.investor_code = ps.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    investor_code, eod_date, opening_balance, deposits, withdrawals,
    gross_sell, gross_buy, total_commission, closing_balance,
    total_stock, saleable, pending_buy, pending_sell,
    total_mv, total_cost, avg_cost, unrealized_pnl,
    matured_balance, receivable_sale, cq_in_transit,
    accrued_interest, cumulative_interest,
    account_type, interest_rate, brokerage_rate
  )
  SELECT 
    investor_code, eod_date, opening_balance, deposits, withdrawals,
    gross_sell, gross_buy, total_commission, closing_balance,
    total_stock, saleable, pending_buy, pending_sell,
    total_mv, total_cost, avg_cost, unrealized_pnl,
    matured_balance, receivable_sale, cq_in_transit,
    accrued_interest, cumulative_interest,
    account_type, interest_rate, brokerage_rate
  FROM calculated
  WHERE NOT (p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots es 
    WHERE es.investor_code = calculated.investor_code 
    AND es.eod_date = p_eod_date
  ));

  -- Get summary statistics
  SELECT 
    COUNT(*),
    COALESCE(SUM(closing_balance), 0),
    COALESCE(SUM(deposits), 0),
    COALESCE(SUM(withdrawals), 0),
    COALESCE(SUM(gross_buy), 0),
    COALESCE(SUM(gross_sell), 0),
    COALESCE(SUM(total_commission), 0)
  INTO 
    v_clients_processed,
    v_total_ledger,
    v_total_deposits,
    v_total_withdrawals,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM eod_ledger_snapshots
  WHERE eod_date = p_eod_date;

  -- Record in history
  INSERT INTO eod_run_history (
    run_date, run_at, run_by, run_by_email,
    clients_captured, total_ledger_balance,
    total_deposits, total_withdrawals,
    gross_buy, gross_sell, total_commission,
    trade_files_count, status
  ) VALUES (
    p_eod_date, now(), auth.uid(), 
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_clients_processed, v_total_ledger,
    v_total_deposits, v_total_withdrawals,
    v_gross_buy, v_gross_sell, v_total_commission,
    v_trade_files_count, 'completed'
  );

  v_result := jsonb_build_object(
    'success', true,
    'eod_date', p_eod_date,
    'clients_processed', v_clients_processed,
    'total_ledger', v_total_ledger,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'trade_files_count', v_trade_files_count
  );

  RETURN v_result;
END;
$$;
