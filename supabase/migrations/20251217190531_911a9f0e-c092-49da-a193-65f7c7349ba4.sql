-- Drop existing RESTRICTIVE policies on trade_history
DROP POLICY IF EXISTS "Admins can manage trade history" ON public.trade_history;
DROP POLICY IF EXISTS "Department heads can view team trades" ON public.trade_history;
DROP POLICY IF EXISTS "RMs can view their client trades" ON public.trade_history;

-- Recreate as PERMISSIVE policies (default, allows OR logic)
CREATE POLICY "Admins can manage trade history" 
ON public.trade_history 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Department heads can view team trades" 
ON public.trade_history 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = trade_history.client_code 
  AND is_department_head_of_rm(c.rm_email)
));

CREATE POLICY "RMs can view their client trades" 
ON public.trade_history 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = trade_history.client_code 
  AND c.rm_email = (auth.jwt() ->> 'email'::text)
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.is_approved = true
  )
));