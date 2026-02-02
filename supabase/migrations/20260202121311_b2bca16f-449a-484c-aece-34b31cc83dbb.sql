-- Fix the get_unmatched_staging_summary function to use correct column names
CREATE OR REPLACE FUNCTION public.get_unmatched_staging_summary(p_trade_date DATE)
RETURNS TABLE (
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
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH unmatched_trades AS (
    SELECT 
      tf.investor_code,
      COUNT(*) as trade_cnt,
      SUM(ABS(COALESCE(tf.qty * tf.price, 0))) as trade_val
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