-- Fix run_batch_eod function: use 'BUY'/'SELL' instead of 'B'/'S' for side column
CREATE OR REPLACE FUNCTION run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
SET search_path = public
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
  v_trade_date_str := to_char(p_eod_date, 'YYYYMMDD');
  v_prev_date := p_eod_date - interval '1 day';

  FOR v_investor IN
    SELECT 
      UPPER(i.investor_code) as inv_code,
      COALESCE(i.brokerage_commission, 0.4) as comm_rate,
      COALESCE(i.ledger_balance, 0) as base_balance,
      i.investor_name as inv_name
    FROM investors i
  LOOP
    BEGIN
      IF p_skip_existing AND EXISTS (
        SELECT 1 FROM eod_ledger_snapshots 
        WHERE eod_date = p_eod_date 
        AND UPPER(investor_code) = v_investor.inv_code
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_commission_rate := v_investor.comm_rate;

      -- Get opening balance from previous day's closing
      SELECT closing_balance INTO v_opening_balance
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date AND UPPER(investor_code) = v_investor.inv_code;
      
      IF v_opening_balance IS NULL THEN
        v_opening_balance := v_investor.base_balance;
      END IF;

      -- Get deposits/withdrawals for this date
      SELECT 
        COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END), 0)
      INTO v_deposits, v_withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = p_eod_date AND UPPER(investor_code) = v_investor.inv_code;

      -- FIXED: Get trades using correct side values ('BUY'/'SELL' not 'B'/'S')
      SELECT 
        COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN value ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN value ELSE 0 END), 0),
        COALESCE(SUM(value), 0)
      INTO v_inv_gross_buy, v_inv_gross_sell, v_inv_commission
      FROM trade_history
      WHERE trade_date = v_trade_date_str AND UPPER(client_code) = v_investor.inv_code;

      -- Commission = turnover * (rate / 100)
      v_inv_commission := v_inv_commission * (v_commission_rate / 100);

      -- Calculate closing balance: opening + deposits - withdrawals + sell - buy - commission
      v_closing_balance := v_opening_balance + v_deposits - v_withdrawals 
                         + v_inv_gross_sell - v_inv_gross_buy - v_inv_commission;

      -- Insert with correct column names
      INSERT INTO eod_ledger_snapshots (
        eod_date, investor_code, investor_name, opening_balance, 
        total_deposits, total_withdrawals,
        gross_buy, gross_sell, total_commission, 
        closing_balance, ledger_balance, brokerage_rate
      ) VALUES (
        p_eod_date, v_investor.inv_code, v_investor.inv_name, v_opening_balance, 
        v_deposits, v_withdrawals,
        v_inv_gross_buy, v_inv_gross_sell, v_inv_commission, 
        v_closing_balance, v_closing_balance, v_commission_rate
      )
      ON CONFLICT (eod_date, investor_code) DO UPDATE SET
        investor_name = EXCLUDED.investor_name,
        opening_balance = EXCLUDED.opening_balance,
        total_deposits = EXCLUDED.total_deposits,
        total_withdrawals = EXCLUDED.total_withdrawals,
        gross_buy = EXCLUDED.gross_buy,
        gross_sell = EXCLUDED.gross_sell,
        total_commission = EXCLUDED.total_commission,
        closing_balance = EXCLUDED.closing_balance,
        ledger_balance = EXCLUDED.ledger_balance,
        brokerage_rate = EXCLUDED.brokerage_rate;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_error_details := v_error_details || jsonb_build_object(
        'investor_code', v_investor.inv_code,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_details', v_error_details,
    'eod_date', p_eod_date
  );
END;
$$;