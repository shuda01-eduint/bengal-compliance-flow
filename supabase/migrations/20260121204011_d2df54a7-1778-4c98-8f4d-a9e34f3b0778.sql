-- Add indexes for faster EOD queries
CREATE INDEX IF NOT EXISTS idx_trade_history_date_client ON trade_history(trade_date, client_code);
CREATE INDEX IF NOT EXISTS idx_deposits_withdrawals_date_investor ON deposits_withdrawals(transaction_date, investor_code);
CREATE INDEX IF NOT EXISTS idx_eod_ledger_snapshots_date_investor ON eod_ledger_snapshots(eod_date, investor_code);

-- Optimized run_batch_eod function
CREATE OR REPLACE FUNCTION run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
DECLARE
  v_processed integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
  v_investor record;
  v_prev_date date;
  v_opening_balance numeric(18,2);
  v_deposits numeric(18,2);
  v_withdrawals numeric(18,2);
  v_inv_gross_buy numeric(18,2);
  v_inv_gross_sell numeric(18,2);
  v_inv_commission numeric(18,2);
  v_closing_balance numeric(18,2);
  v_commission_rate numeric(10,4);
  v_trade_date_str text;
  v_error_details jsonb := '[]'::jsonb;
BEGIN
  -- Convert date to string format for trade_history comparison
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_prev_date := p_eod_date - interval '1 day';

  -- Pre-aggregate all trade data for this date
  CREATE TEMP TABLE IF NOT EXISTS temp_trades AS
  SELECT 
    UPPER(client_code) as inv_code,
    SUM(CASE WHEN UPPER(side) = 'B' THEN value ELSE 0 END) as gross_buy,
    SUM(CASE WHEN UPPER(side) = 'S' THEN value ELSE 0 END) as gross_sell,
    SUM(value) as total_value
  FROM trade_history
  WHERE trade_date = v_trade_date_str
  GROUP BY UPPER(client_code);

  -- Pre-aggregate all deposits/withdrawals for this date
  CREATE TEMP TABLE IF NOT EXISTS temp_transactions AS
  SELECT 
    UPPER(investor_code) as inv_code,
    SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
    SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
  GROUP BY UPPER(investor_code);

  -- Pre-fetch previous day snapshots
  CREATE TEMP TABLE IF NOT EXISTS temp_prev_snapshots AS
  SELECT UPPER(investor_code) as inv_code, closing_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = v_prev_date;

  -- Clear temp tables if they already exist (for re-runs)
  TRUNCATE temp_trades;
  TRUNCATE temp_transactions;
  TRUNCATE temp_prev_snapshots;

  -- Re-populate temp tables
  INSERT INTO temp_trades
  SELECT 
    UPPER(client_code) as inv_code,
    SUM(CASE WHEN UPPER(side) = 'B' THEN value ELSE 0 END) as gross_buy,
    SUM(CASE WHEN UPPER(side) = 'S' THEN value ELSE 0 END) as gross_sell,
    SUM(value) as total_value
  FROM trade_history
  WHERE trade_date = v_trade_date_str
  GROUP BY UPPER(client_code);

  INSERT INTO temp_transactions
  SELECT 
    UPPER(investor_code) as inv_code,
    SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END) as deposits,
    SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END) as withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
  GROUP BY UPPER(investor_code);

  INSERT INTO temp_prev_snapshots
  SELECT UPPER(investor_code) as inv_code, closing_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = v_prev_date;

  -- Loop through all investors (simplified - just use investors table)
  FOR v_investor IN
    SELECT 
      UPPER(i.investor_code) as inv_code,
      COALESCE(i.commission_rate, 0.4) as comm_rate,
      COALESCE(i.ledger_balance, 0) as base_balance
    FROM investors i
  LOOP
    BEGIN
      -- Skip if exists and skip flag is true
      IF p_skip_existing AND EXISTS (
        SELECT 1 FROM eod_ledger_snapshots 
        WHERE eod_date = p_eod_date 
        AND UPPER(investor_code) = v_investor.inv_code
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Get commission rate
      v_commission_rate := v_investor.comm_rate;

      -- Get opening balance from previous day snapshot or base balance
      SELECT closing_balance INTO v_opening_balance
      FROM temp_prev_snapshots
      WHERE inv_code = v_investor.inv_code;
      
      IF v_opening_balance IS NULL THEN
        v_opening_balance := v_investor.base_balance;
      END IF;

      -- Get deposits/withdrawals from temp table
      SELECT COALESCE(deposits, 0), COALESCE(withdrawals, 0)
      INTO v_deposits, v_withdrawals
      FROM temp_transactions
      WHERE inv_code = v_investor.inv_code;
      
      IF v_deposits IS NULL THEN v_deposits := 0; END IF;
      IF v_withdrawals IS NULL THEN v_withdrawals := 0; END IF;

      -- Get trade values from temp table
      SELECT COALESCE(gross_buy, 0), COALESCE(gross_sell, 0), COALESCE(total_value, 0)
      INTO v_inv_gross_buy, v_inv_gross_sell, v_inv_commission
      FROM temp_trades
      WHERE inv_code = v_investor.inv_code;
      
      IF v_inv_gross_buy IS NULL THEN v_inv_gross_buy := 0; END IF;
      IF v_inv_gross_sell IS NULL THEN v_inv_gross_sell := 0; END IF;
      IF v_inv_commission IS NULL THEN v_inv_commission := 0; END IF;

      -- Calculate commission on total trade value
      v_inv_commission := v_inv_commission * (v_commission_rate / 100);

      -- Calculate closing balance
      v_closing_balance := v_opening_balance + v_deposits - v_withdrawals 
                         + v_inv_gross_sell - v_inv_gross_buy - v_inv_commission;

      -- Upsert the snapshot (holdings set to 0 for now)
      INSERT INTO eod_ledger_snapshots (
        eod_date, investor_code, opening_balance, deposits, withdrawals,
        gross_buy, gross_sell, commission, closing_balance,
        holdings_quantity, holdings_value
      ) VALUES (
        p_eod_date, v_investor.inv_code, v_opening_balance, v_deposits, v_withdrawals,
        v_inv_gross_buy, v_inv_gross_sell, v_inv_commission, v_closing_balance,
        0, 0
      )
      ON CONFLICT (eod_date, investor_code) DO UPDATE SET
        opening_balance = EXCLUDED.opening_balance,
        deposits = EXCLUDED.deposits,
        withdrawals = EXCLUDED.withdrawals,
        gross_buy = EXCLUDED.gross_buy,
        gross_sell = EXCLUDED.gross_sell,
        commission = EXCLUDED.commission,
        closing_balance = EXCLUDED.closing_balance,
        holdings_quantity = EXCLUDED.holdings_quantity,
        holdings_value = EXCLUDED.holdings_value,
        updated_at = now();

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_error_details := v_error_details || jsonb_build_object(
        'investor_code', v_investor.inv_code,
        'error', SQLERRM
      );
    END;
  END LOOP;

  -- Cleanup temp tables
  DROP TABLE IF EXISTS temp_trades;
  DROP TABLE IF EXISTS temp_transactions;
  DROP TABLE IF EXISTS temp_prev_snapshots;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_details', v_error_details,
    'eod_date', p_eod_date
  );
END;
$$;