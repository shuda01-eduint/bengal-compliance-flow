-- Fix holdings table RLS policies to use proper role-based access control
DROP POLICY IF EXISTS "Admins can manage all holdings" ON public.holdings;

CREATE POLICY "Admins manage holdings" ON public.holdings 
  FOR ALL 
  USING (has_role(auth.uid(), 'admin')) 
  WITH CHECK (has_role(auth.uid(), 'admin'));