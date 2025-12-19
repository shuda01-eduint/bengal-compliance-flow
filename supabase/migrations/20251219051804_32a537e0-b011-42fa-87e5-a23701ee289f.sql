-- Create a function to check if user is in Settlement department
CREATE OR REPLACE FUNCTION public.is_settlement_department()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.employees e
    JOIN public.profiles p ON LOWER(p.email) = LOWER(e.email)
    WHERE p.id = auth.uid()
      AND p.is_approved = true
      AND e.department = 'Settlement & Support Services'
  )
$$;

-- Create a view for limited investor data (only names and codes)
CREATE OR REPLACE VIEW public.investors_limited AS
SELECT 
  id,
  investor_code,
  investor_name,
  investor_type,
  status,
  account_type,
  trader,
  created_at,
  updated_at
FROM public.investors;

-- Drop existing RLS policies on investors table
DROP POLICY IF EXISTS "Admins can manage investors" ON public.investors;
DROP POLICY IF EXISTS "Approved users can view investors" ON public.investors;

-- Create new RLS policies for investors table

-- Admins have full access
CREATE POLICY "Admins can manage investors" 
ON public.investors 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Settlement department employees have full read access
CREATE POLICY "Settlement can view all investor data" 
ON public.investors 
FOR SELECT 
USING (is_settlement_department());

-- Department heads and MANCOM can only see investors via investors_limited view
-- They cannot access full investor table directly
CREATE POLICY "Department heads view limited investor data"
ON public.investors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_department_head = true
      AND profiles.is_approved = true
  )
);

CREATE POLICY "MANCOM view limited investor data"
ON public.investors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_mancom = true
      AND profiles.is_approved = true
  )
);

-- Regular approved RMs can view their assigned investors only
CREATE POLICY "RMs can view their assigned investors"
ON public.investors
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM investor_rm_assignments ira
    WHERE ira.investor_code = investors.investor_code
      AND LOWER(ira.rm_email) = LOWER(auth.jwt() ->> 'email')
  )
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.is_approved = true
  )
);