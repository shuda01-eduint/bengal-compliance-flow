-- Drop existing restrictive policies on portfolios
DROP POLICY IF EXISTS "Admins can manage portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Department heads can view team portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "RMs can view their portfolios" ON public.portfolios;

-- Recreate as PERMISSIVE policies (default behavior, OR logic)
CREATE POLICY "Admins can manage portfolios" 
ON public.portfolios 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Department heads can view team portfolios" 
ON public.portfolios 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = portfolios.investor_code 
  AND is_department_head_of_rm(c.rm_email)
));

CREATE POLICY "RMs can view their portfolios" 
ON public.portfolios 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = portfolios.investor_code 
  AND c.rm_email = (auth.jwt() ->> 'email'::text)
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.is_approved = true
  )
));