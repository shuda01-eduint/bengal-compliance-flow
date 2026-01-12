-- Drop the unique constraint that prevents legitimate duplicate transactions
DROP INDEX IF EXISTS deposits_withdrawals_unique_transaction;

-- Create a helper function to count existing deposits/withdrawals for a given date
CREATE OR REPLACE FUNCTION get_deposit_withdrawal_counts(p_date date)
RETURNS TABLE(investor_code text, amount numeric, transaction_type text, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    dw.investor_code::text, 
    dw.amount::numeric, 
    dw.transaction_type::text, 
    COUNT(*)::bigint
  FROM deposits_withdrawals dw
  WHERE dw.transaction_date = p_date
  GROUP BY dw.investor_code, dw.amount, dw.transaction_type;
$$;