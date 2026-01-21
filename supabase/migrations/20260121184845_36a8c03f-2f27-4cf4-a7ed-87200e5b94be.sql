-- Step 1: Add new columns to eod_ledger_snapshots for complete daily position tracking

-- Holdings Quantities
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS total_stock integer DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS saleable integer DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS pending_buy integer DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS pending_sell integer DEFAULT 0;

-- Holdings Values
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS total_mv numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS total_cost numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS avg_cost numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS unrealized_pnl numeric DEFAULT 0;

-- Cash/Settlement
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS matured_balance numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS receivable_sale numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS cq_in_transit numeric DEFAULT 0;

-- Fees and Interest
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS accrued_interest numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS cumulative_interest numeric DEFAULT 0;

-- Account Configuration (snapshot)
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS account_type text;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS interest_rate numeric DEFAULT 0;
ALTER TABLE eod_ledger_snapshots ADD COLUMN IF NOT EXISTS brokerage_rate numeric DEFAULT 0;

-- Step 2: Update run_batch_eod function with complete logic
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_result jsonb;
  v_processed int := 0;
  v_skipped int := 0;
  v_errors text[] := ARRAY[]::text[];
  v_user_role text;
BEGIN
  -- Check if user has admin role
  SELECT 
    CASE WHEN EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    ) THEN 'admin' ELSE 'user' END
  INTO v_user_role;
  
  IF v_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin role required'
    );
  END IF;

  -- Delete existing records for this date if not skipping
  IF NOT p_skip_existing THEN
    DELETE FROM eod_ledger_snapshots WHERE eod_date = p_eod_date;
  END IF;

  -- Insert EOD snapshots for all investors
  WITH 
  prev_day AS (
    SELECT investor_code, closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date = p_eod_date - 1
  ),
  all_investors AS (
    SELECT DISTINCT investor_code FROM (
      SELECT investor_code FROM prev_day
      UNION
      SELECT investor_code FROM clients WHERE investor_code IS NOT NULL
      UNION
      SELECT investor_code FROM investors WHERE investor_code IS NOT NULL
    ) combined
  ),
  -- Get investor master data for account config
  investor_config AS (
    SELECT 
      investor_code,
      investor_name,
      rm_email,
      COALESCE(account_type, 'cash') as account_type,
      COALESCE(interest_rate, 0) as interest_rate,
      COALESCE(brokerage_commission, 0.4) as brokerage_rate
    FROM investors
  ),
  -- Get holdings data from balances_raw (latest available up to EOD date)
  holdings_data AS (
    SELECT 
      investor_code,
      SUM(COALESCE(total_stock, 0))::integer as total_stock,
      SUM(COALESCE(saleable, 0))::integer as saleable,
      SUM(COALESCE(total_mv, 0)) as total_mv,
      SUM(COALESCE(total_cost, 0)) as total_cost,
      CASE WHEN SUM(COALESCE(total_stock, 0)) > 0 
        THEN SUM(COALESCE(total_cost, 0)) / NULLIF(SUM(COALESCE(total_stock, 0)), 0)
        ELSE 0 END as avg_cost,
      SUM(COALESCE(receivable_sale, 0)) as receivable_sale,
      SUM(COALESCE(cq_in_transit, 0)) as cq_in_transit,
      SUM(COALESCE(matured_balance, 0)) as matured_balance
    FROM balances_raw
    WHERE as_of_date = (SELECT MAX(as_of_date) FROM balances_raw WHERE as_of_date <= p_eod_date)
    GROUP BY investor_code
  ),
  -- Calculate pending settlement quantities from recent trades (T+2/T+3 window)
  pending_trades AS (
    SELECT 
      client_code,
      SUM(CASE WHEN side = 'BUY' THEN COALESCE(quantity, 0) ELSE 0 END)::integer as pending_buy,
      SUM(CASE WHEN side = 'SELL' THEN COALESCE(quantity, 0) ELSE 0 END)::integer as pending_sell
    FROM trade_history
    WHERE trade_date >= to_char(p_eod_date - 3, 'YYYYMMDD')
      AND trade_date <= to_char(p_eod_date, 'YYYYMMDD')
      AND COALESCE(status, fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY client_code
  ),
  trade_activity AS (
    SELECT 
      th.client_code,
      SUM(CASE WHEN th.side = 'BUY' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as buy_value,
      SUM(CASE WHEN th.side = 'SELL' THEN COALESCE(th.value, th.quantity * th.price) ELSE 0 END) as sell_value,
      SUM(
        COALESCE(th.value, th.quantity * th.price) * 
        CASE 
          WHEN COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.4) >= 0.1 
          THEN COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.4) / 100
          ELSE COALESCE(th.brokerage_commission, inv.brokerage_commission, 0.004)
        END
      ) as commission
    FROM trade_history th
    LEFT JOIN investors inv ON th.client_code = inv.investor_code
    WHERE th.trade_date = to_char(p_eod_date, 'YYYYMMDD')
      AND COALESCE(th.status, th.fill_type) IN ('FILL', 'PF', 'FILLED', 'PARTIAL')
    GROUP BY th.client_code
  ),
  txn_activity AS (
    SELECT 
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  eod_calc AS (
    SELECT 
      ai.investor_code,
      ic.investor_name,
      ic.rm_email,
      ic.account_type,
      ic.interest_rate,
      ic.brokerage_rate,
      -- Opening balance from previous day or zero
      COALESCE(pd.closing_balance, 0) as opening_balance,
      -- Trade activity
      COALESCE(ta.sell_value, 0) as gross_sell,
      COALESCE(ta.buy_value, 0) as gross_buy,
      COALESCE(ta.commission, 0) as total_commission,
      -- Transaction activity
      COALESCE(tx.deposits, 0) as total_deposits,
      COALESCE(tx.withdrawals, 0) as total_withdrawals,
      -- Closing balance calculation
      COALESCE(pd.closing_balance, 0) 
        + COALESCE(tx.deposits, 0) 
        - COALESCE(tx.withdrawals, 0)
        + COALESCE(ta.sell_value, 0) 
        - COALESCE(ta.buy_value, 0) 
        - COALESCE(ta.commission, 0) as closing_balance,
      -- Holdings quantities
      COALESCE(hd.total_stock, 0) as total_stock,
      COALESCE(hd.saleable, 0) as saleable,
      COALESCE(pt.pending_buy, 0) as pending_buy,
      COALESCE(pt.pending_sell, 0) as pending_sell,
      -- Holdings values
      COALESCE(hd.total_mv, 0) as total_mv,
      COALESCE(hd.total_cost, 0) as total_cost,
      COALESCE(hd.avg_cost, 0) as avg_cost,
      COALESCE(hd.total_mv, 0) - COALESCE(hd.total_cost, 0) as unrealized_pnl,
      -- Cash/Settlement
      COALESCE(hd.matured_balance, 0) as matured_balance,
      COALESCE(hd.receivable_sale, 0) as receivable_sale,
      COALESCE(hd.cq_in_transit, 0) as cq_in_transit,
      -- Accrued interest (only for margin accounts with negative balance)
      CASE 
        WHEN ic.account_type = 'margin' AND (
          COALESCE(pd.closing_balance, 0) 
          + COALESCE(tx.deposits, 0) 
          - COALESCE(tx.withdrawals, 0)
          + COALESCE(ta.sell_value, 0) 
          - COALESCE(ta.buy_value, 0) 
          - COALESCE(ta.commission, 0)
        ) < 0 
        THEN (COALESCE(ic.interest_rate, 0) / 365 / 100) * ABS(
          COALESCE(pd.closing_balance, 0) 
          + COALESCE(tx.deposits, 0) 
          - COALESCE(tx.withdrawals, 0)
          + COALESCE(ta.sell_value, 0) 
          - COALESCE(ta.buy_value, 0) 
          - COALESCE(ta.commission, 0)
        )
        ELSE 0 
      END as accrued_interest,
      -- Cumulative interest (previous + today's accrued)
      COALESCE(pd.cumulative_interest, 0) as prev_cumulative_interest
    FROM all_investors ai
    LEFT JOIN investor_config ic ON ai.investor_code = ic.investor_code
    LEFT JOIN prev_day pd ON ai.investor_code = pd.investor_code
    LEFT JOIN holdings_data hd ON ai.investor_code = hd.investor_code
    LEFT JOIN pending_trades pt ON ai.investor_code = pt.client_code
    LEFT JOIN trade_activity ta ON ai.investor_code = ta.client_code
    LEFT JOIN txn_activity tx ON ai.investor_code = tx.investor_code
  )
  INSERT INTO eod_ledger_snapshots (
    eod_date,
    investor_code,
    investor_name,
    rm_email,
    ledger_balance,
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    net_trade_value,
    total_deposits,
    total_withdrawals,
    total_commission,
    -- Holdings Quantities
    total_stock,
    saleable,
    pending_buy,
    pending_sell,
    -- Holdings Values
    total_mv,
    total_cost,
    avg_cost,
    unrealized_pnl,
    -- Cash/Settlement
    matured_balance,
    receivable_sale,
    cq_in_transit,
    -- Fees
    accrued_interest,
    cumulative_interest,
    -- Account Config
    account_type,
    interest_rate,
    brokerage_rate
  )
  SELECT 
    p_eod_date,
    investor_code,
    investor_name,
    rm_email,
    opening_balance,  -- ledger_balance = opening for compatibility
    opening_balance,
    closing_balance,
    gross_buy,
    gross_sell,
    gross_sell - gross_buy as net_trade_value,
    total_deposits,
    total_withdrawals,
    total_commission,
    -- Holdings Quantities
    total_stock,
    saleable,
    pending_buy,
    pending_sell,
    -- Holdings Values
    total_mv,
    total_cost,
    avg_cost,
    unrealized_pnl,
    -- Cash/Settlement
    matured_balance,
    receivable_sale,
    cq_in_transit,
    -- Fees
    accrued_interest,
    prev_cumulative_interest + accrued_interest as cumulative_interest,
    -- Account Config
    account_type,
    interest_rate,
    brokerage_rate
  FROM eod_calc
  WHERE NOT (p_skip_existing AND EXISTS (
    SELECT 1 FROM eod_ledger_snapshots es 
    WHERE es.eod_date = p_eod_date AND es.investor_code = eod_calc.investor_code
  ));

  GET DIAGNOSTICS v_processed = ROW_COUNT;

  -- Record the run in history
  INSERT INTO eod_run_history (
    run_date,
    run_at,
    run_by,
    run_by_email,
    clients_captured,
    status
  )
  VALUES (
    p_eod_date,
    now(),
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    v_processed,
    'completed'
  )
  ON CONFLICT (run_date) DO UPDATE SET
    run_at = now(),
    run_by = auth.uid(),
    run_by_email = (SELECT email FROM auth.users WHERE id = auth.uid()),
    clients_captured = v_processed,
    status = 'completed';

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'date', p_eod_date
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'date', p_eod_date
  );
END;
$function$;