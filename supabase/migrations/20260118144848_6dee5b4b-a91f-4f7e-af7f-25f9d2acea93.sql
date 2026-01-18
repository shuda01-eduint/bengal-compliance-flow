-- Fix run_batch_eod to calculate commission as value * rate
-- brokerage_commission stores rates like 0.4 (meaning 0.4%) or 0.004 (meaning 0.4%)
-- Normalize: if >= 0.1, treat as percent and divide by 100; else use as-is

CREATE OR REPLACE FUNCTION public.run_batch_eod(p_start_date date, p_end_date date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date;
  v_prev_date date;
  v_records_processed int := 0;
  v_dates_processed int := 0;
  v_result json;
BEGIN
  -- Loop through each date in the range
  v_current_date := p_start_date;
  
  WHILE v_current_date <= p_end_date LOOP
    v_prev_date := v_current_date - interval '1 day';
    
    -- Delete existing snapshots for this date (to allow re-run)
    DELETE FROM eod_ledger_snapshots WHERE eod_date = v_current_date;
    
    -- Insert new snapshots
    WITH prev_balances AS (
      SELECT investor_code, ledger_balance, investor_name, rm_email
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date
    ),
    daily_trades AS (
      -- Calculate commission as value * normalized_rate
      -- If brokerage_commission >= 0.1, treat as percent (divide by 100)
      -- Else treat as decimal rate
      SELECT 
        t.client_code as investor_code,
        COALESCE(SUM(CASE WHEN t.side IN ('SELL', 'S') THEN t.value ELSE 0 END), 0) as sell_value,
        COALESCE(SUM(CASE WHEN t.side IN ('BUY', 'B') THEN t.value ELSE 0 END), 0) as buy_value,
        COALESCE(SUM(
          t.value * CASE 
            WHEN COALESCE(t.brokerage_commission, 0) >= 0.1 THEN t.brokerage_commission / 100.0
            ELSE COALESCE(t.brokerage_commission, 0)
          END
        ), 0) as commission
      FROM trade_history t
      WHERE t.trade_date = to_char(v_current_date, 'YYYYMMDD')
      GROUP BY t.client_code
    ),
    daily_deposits AS (
      SELECT 
        investor_code,
        COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) as deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) as withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = v_current_date
      GROUP BY investor_code
    ),
    all_investors AS (
      SELECT investor_code FROM prev_balances
      UNION
      SELECT investor_code FROM daily_trades
      UNION
      SELECT investor_code FROM daily_deposits
    )
    INSERT INTO eod_ledger_snapshots (eod_date, investor_code, ledger_balance, investor_name, rm_email)
    SELECT 
      v_current_date,
      ai.investor_code,
      -- Calculate: prev_balance + deposits - withdrawals + sell_value - buy_value - commission
      COALESCE(pb.ledger_balance, 0) 
        + COALESCE(dd.deposits, 0) 
        - COALESCE(dd.withdrawals, 0)
        + COALESCE(dt.sell_value, 0) 
        - COALESCE(dt.buy_value, 0) 
        - COALESCE(dt.commission, 0) as ledger_balance,
      COALESCE(pb.investor_name, i.investor_name),
      COALESCE(pb.rm_email, ira.rm_email)
    FROM all_investors ai
    LEFT JOIN prev_balances pb ON pb.investor_code = ai.investor_code
    LEFT JOIN daily_trades dt ON dt.investor_code = ai.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = ai.investor_code
    LEFT JOIN investors i ON i.investor_code = ai.investor_code
    LEFT JOIN investor_rm_assignments ira ON ira.investor_code = ai.investor_code;
    
    GET DIAGNOSTICS v_records_processed = ROW_COUNT;
    v_dates_processed := v_dates_processed + 1;
    
    v_current_date := v_current_date + interval '1 day';
  END LOOP;
  
  v_result := json_build_object(
    'success', true,
    'dates_processed', v_dates_processed,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'message', format('Processed %s dates from %s to %s', v_dates_processed, p_start_date, p_end_date)
  );
  
  RETURN v_result;
END;
$$;

-- Also fix get_accounting_data_v3 to include commission in closing_balance
CREATE OR REPLACE FUNCTION public.get_accounting_data_v3(
  _opening_date date,
  _tx_date date,
  _search text DEFAULT '',
  _account_type_filter text DEFAULT 'all',
  _has_activity_filter text DEFAULT 'all',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  department text,
  rm text,
  opening_balance numeric,
  deposits numeric,
  withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  brokerage_amount numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH opening_balances AS (
    SELECT 
      e.investor_code,
      e.investor_name,
      e.ledger_balance as opening_balance,
      e.rm_email
    FROM eod_ledger_snapshots e
    WHERE e.eod_date = _opening_date
  ),
  trade_sums AS (
    SELECT 
      t.client_code as investor_code,
      COALESCE(SUM(CASE WHEN t.side IN ('BUY', 'B') THEN t.value ELSE 0 END), 0) as gross_buy,
      COALESCE(SUM(CASE WHEN t.side IN ('SELL', 'S') THEN t.value ELSE 0 END), 0) as gross_sell,
      COALESCE(SUM(
        t.value * CASE 
          WHEN COALESCE(t.brokerage_commission, 0) >= 0.1 THEN t.brokerage_commission / 100.0
          ELSE COALESCE(t.brokerage_commission, 0)
        END
      ), 0) as commission_sum
    FROM trade_history t
    WHERE t.trade_date >= to_char(_opening_date + interval '1 day', 'YYYYMMDD')
      AND t.trade_date <= to_char(_tx_date, 'YYYYMMDD')
    GROUP BY t.client_code
  ),
  deposit_sums AS (
    SELECT 
      d.investor_code,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'Deposit' THEN d.amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'Withdrawal' THEN d.amount ELSE 0 END), 0) as withdrawals
    FROM deposits_withdrawals d
    WHERE d.transaction_date > _opening_date
      AND d.transaction_date <= _tx_date
    GROUP BY d.investor_code
  ),
  all_codes AS (
    SELECT ob.investor_code FROM opening_balances ob
    UNION
    SELECT ts.investor_code FROM trade_sums ts
    UNION
    SELECT ds.investor_code FROM deposit_sums ds
  ),
  combined AS (
    SELECT 
      ac.investor_code,
      COALESCE(ob.investor_name, inv.investor_name) as investor_name,
      COALESCE(inv.account_type, 'Unknown') as account_type,
      COALESCE(ira.department, 'Unassigned') as department,
      COALESCE(ira.rm_name, ob.rm_email, 'Unassigned') as rm,
      COALESCE(ob.opening_balance, 0) as opening_balance,
      COALESCE(ds.deposits, 0) as deposits,
      COALESCE(ds.withdrawals, 0) as withdrawals,
      COALESCE(ts.gross_buy, 0) as gross_buy,
      COALESCE(ts.gross_sell, 0) as gross_sell,
      COALESCE(ts.commission_sum, 0) as brokerage_amount,
      -- closing = opening + deposits - withdrawals - gross_buy + gross_sell - commission
      COALESCE(ob.opening_balance, 0) 
        + COALESCE(ds.deposits, 0) 
        - COALESCE(ds.withdrawals, 0)
        - COALESCE(ts.gross_buy, 0) 
        + COALESCE(ts.gross_sell, 0)
        - COALESCE(ts.commission_sum, 0) as closing_balance
    FROM all_codes ac
    LEFT JOIN opening_balances ob ON ob.investor_code = ac.investor_code
    LEFT JOIN trade_sums ts ON ts.investor_code = ac.investor_code
    LEFT JOIN deposit_sums ds ON ds.investor_code = ac.investor_code
    LEFT JOIN investors inv ON inv.investor_code = ac.investor_code
    LEFT JOIN investor_rm_assignments ira ON ira.investor_code = ac.investor_code
  )
  SELECT 
    c.investor_code,
    c.investor_name,
    c.account_type,
    c.department,
    c.rm,
    c.opening_balance,
    c.deposits,
    c.withdrawals,
    c.gross_buy,
    c.gross_sell,
    c.brokerage_amount,
    c.closing_balance
  FROM combined c
  WHERE (
    _search = '' 
    OR c.investor_code ILIKE '%' || _search || '%'
    OR c.investor_name ILIKE '%' || _search || '%'
  )
  AND (
    _account_type_filter = 'all' 
    OR c.account_type ILIKE '%' || _account_type_filter || '%'
  )
  AND (
    _has_activity_filter = 'all'
    OR (_has_activity_filter = 'with_activity' AND (c.gross_buy > 0 OR c.gross_sell > 0 OR c.deposits > 0 OR c.withdrawals > 0))
    OR (_has_activity_filter = 'no_activity' AND c.gross_buy = 0 AND c.gross_sell = 0 AND c.deposits = 0 AND c.withdrawals = 0)
  )
  ORDER BY c.investor_code
  LIMIT _limit
  OFFSET _offset;
END;
$$;