-- Step 0 in process_staged_trades: Auto-create missing investors before EOD processing
-- This ensures all investor codes in trades and cash transactions have master records

CREATE OR REPLACE FUNCTION public.auto_create_missing_investors(p_trade_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  -- Insert placeholder records for investor codes found in staging tables
  -- that don't exist in the investors master table
  INSERT INTO investors (investor_code, investor_name, brokerage_commission, status, created_at, updated_at)
  SELECT DISTINCT
    combined.investor_code,
    'Pending Update',
    0.004,  -- Default 0.4% commission
    'Auto-Created',
    NOW(),
    NOW()
  FROM (
    SELECT DISTINCT investor_code FROM trade_file WHERE trade_date = p_trade_date AND investor_code IS NOT NULL
    UNION
    SELECT DISTINCT investor_code FROM cash_ledger_txn WHERE txn_date = p_trade_date AND investor_code IS NOT NULL
  ) combined
  WHERE NOT EXISTS (
    SELECT 1 FROM investors i WHERE i.investor_code = combined.investor_code
  )
  ON CONFLICT (investor_code) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  IF v_inserted_count > 0 THEN
    RAISE NOTICE 'Auto-created % placeholder investor records for date %', v_inserted_count, p_trade_date;
  END IF;
  
  RETURN v_inserted_count;
END;
$$;

-- RPC function to get summary of unmatched staging data for a given date
CREATE OR REPLACE FUNCTION public.get_unmatched_staging_summary(p_trade_date DATE)
RETURNS TABLE(
  unmatched_trade_count INTEGER,
  unmatched_trade_value NUMERIC,
  unmatched_deposit_count INTEGER,
  unmatched_deposit_value NUMERIC,
  unmatched_withdrawal_count INTEGER,
  unmatched_withdrawal_value NUMERIC,
  sample_codes TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH unmatched_trades AS (
    SELECT 
      tf.investor_code,
      COUNT(*) as trade_cnt,
      SUM(ABS(COALESCE(tf.value, tf.quantity * tf.price, 0))) as trade_val
    FROM trade_file tf
    LEFT JOIN investors i ON i.investor_code = tf.investor_code
    WHERE tf.trade_date = p_trade_date
      AND i.investor_code IS NULL
    GROUP BY tf.investor_code
  ),
  unmatched_deposits AS (
    SELECT 
      clt.investor_code,
      COUNT(*) FILTER (WHERE UPPER(clt.type) IN ('DEPOSIT', 'RECEIPT')) as deposit_cnt,
      SUM(clt.amount) FILTER (WHERE UPPER(clt.type) IN ('DEPOSIT', 'RECEIPT')) as deposit_val,
      COUNT(*) FILTER (WHERE UPPER(clt.type) IN ('WITHDRAW', 'WITHDRAWAL', 'PAID')) as withdrawal_cnt,
      SUM(clt.amount) FILTER (WHERE UPPER(clt.type) IN ('WITHDRAW', 'WITHDRAWAL', 'PAID')) as withdrawal_val
    FROM cash_ledger_txn clt
    LEFT JOIN investors i ON i.investor_code = clt.investor_code
    WHERE clt.txn_date = p_trade_date
      AND i.investor_code IS NULL
    GROUP BY clt.investor_code
  ),
  combined AS (
    SELECT investor_code FROM unmatched_trades
    UNION
    SELECT investor_code FROM unmatched_deposits
  )
  SELECT
    COALESCE(SUM(ut.trade_cnt), 0)::INTEGER as unmatched_trade_count,
    COALESCE(SUM(ut.trade_val), 0)::NUMERIC as unmatched_trade_value,
    COALESCE(SUM(ud.deposit_cnt), 0)::INTEGER as unmatched_deposit_count,
    COALESCE(SUM(ud.deposit_val), 0)::NUMERIC as unmatched_deposit_value,
    COALESCE(SUM(ud.withdrawal_cnt), 0)::INTEGER as unmatched_withdrawal_count,
    COALESCE(SUM(ud.withdrawal_val), 0)::NUMERIC as unmatched_withdrawal_value,
    (SELECT array_agg(c.investor_code ORDER BY c.investor_code) FROM (SELECT investor_code FROM combined LIMIT 10) c) as sample_codes
  FROM combined
  LEFT JOIN unmatched_trades ut ON ut.investor_code = combined.investor_code
  LEFT JOIN unmatched_deposits ud ON ud.investor_code = combined.investor_code;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.auto_create_missing_investors(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_staging_summary(DATE) TO authenticated;