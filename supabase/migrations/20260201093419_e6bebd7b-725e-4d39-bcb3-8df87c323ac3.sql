-- Create bulk update function for investor ledger balances
CREATE OR REPLACE FUNCTION update_investor_balances_bulk(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE investors i
  SET ledger_balance = (u->>'ledger_balance')::numeric,
      updated_at = now()
  FROM jsonb_array_elements(updates) AS u
  WHERE i.investor_code = u->>'investor_code';
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Create bulk update function for investor commission rates
CREATE OR REPLACE FUNCTION update_investor_commissions_bulk(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE investors i
  SET brokerage_commission = (u->>'brokerage_commission')::numeric,
      updated_at = now()
  FROM jsonb_array_elements(updates) AS u
  WHERE i.investor_code = u->>'investor_code';
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;