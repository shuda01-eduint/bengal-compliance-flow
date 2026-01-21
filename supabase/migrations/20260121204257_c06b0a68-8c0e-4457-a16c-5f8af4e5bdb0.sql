-- Simplified run_batch_eod function without temp tables
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
      COALESCE(i.commission_rate, 0.4) as comm_rate,
      COALESCE(i.ledger_balance, 0) as base_balance
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

      SELECT closing_balance INTO v_opening_balance
      FROM eod_ledger_snapshots
      WHERE eod_date = v_prev_date AND UPPER(investor_code) = v_investor.inv_code;
      
      IF v_opening_balance IS NULL THEN
        v_opening_balance := v_investor.base_balance;
      END IF;

      SELECT 
        COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN UPPER(transaction_type) = 'WITHDRAWAL' THEN amount ELSE 0 END), 0)
      INTO v_deposits, v_withdrawals
      FROM deposits_withdrawals
      WHERE transaction_date = p_eod_date AND UPPER(investor_code) = v_investor.inv_code;

      SELECT 
        COALESCE(SUM(CASE WHEN UPPER(side) = 'B' THEN value ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN UPPER(side) = 'S' THEN value ELSE 0 END), 0),
        COALESCE(SUM(value), 0)
      INTO v_inv_gross_buy, v_inv_gross_sell, v_inv_commission
      FROM trade_history
      WHERE trade_date = v_trade_date_str AND UPPER(client_code) = v_investor.inv_code;

      v_inv_commission := v_inv_commission * (v_commission_rate / 100);

      v_closing_balance := v_opening_balance + v_deposits - v_withdrawals 
                         + v_inv_gross_sell - v_inv_gross_buy - v_inv_commission;

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

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_details', v_error_details,
    'eod_date', p_eod_date
  );
END;
$$;