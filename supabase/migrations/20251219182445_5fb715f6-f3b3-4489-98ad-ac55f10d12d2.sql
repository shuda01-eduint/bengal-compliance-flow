-- Create a fast SECURITY DEFINER function for CEO dashboard balance fetching
-- This bypasses RLS for admin/MANCOM users to avoid timeout on 74k+ rows

CREATE OR REPLACE FUNCTION public.get_balances_for_ceo_dashboard(target_date date)
RETURNS TABLE (
  id uuid,
  as_of_date date,
  investor_code text,
  instrument text,
  total_stock integer,
  saleable integer,
  avg_cost numeric,
  total_cost numeric,
  total_mv numeric,
  ledger_balance numeric,
  matured_balance numeric,
  receivable_sale numeric,
  cq_in_transit numeric,
  rm_id text,
  rm_name text,
  rm_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow admin or approved MANCOM/department head users
  IF NOT (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND (profiles.is_mancom = true OR profiles.is_department_head = true)
      AND profiles.is_approved = true
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: Admin or MANCOM role required';
  END IF;
  
  RETURN QUERY 
  SELECT 
    br.id,
    br.as_of_date,
    br.investor_code,
    br.instrument,
    br.total_stock,
    br.saleable,
    br.avg_cost,
    br.total_cost,
    br.total_mv,
    br.ledger_balance,
    br.matured_balance,
    br.receivable_sale,
    br.cq_in_transit,
    br.rm_id,
    br.rm_name,
    br.rm_email
  FROM balances_raw br
  WHERE br.as_of_date = target_date;
END;
$$;