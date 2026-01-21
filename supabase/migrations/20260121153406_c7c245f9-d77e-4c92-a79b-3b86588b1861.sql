-- Fix securities table RLS: Replace overly permissive write policies with admin-only policies

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can insert securities" ON public.securities;
DROP POLICY IF EXISTS "Anyone can update securities" ON public.securities;
DROP POLICY IF EXISTS "Anyone can delete securities" ON public.securities;
DROP POLICY IF EXISTS "Anyone can view securities" ON public.securities;

-- Add admin-only write policies
CREATE POLICY "Admins can insert securities"
ON public.securities FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update securities"
ON public.securities FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete securities"
ON public.securities FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Keep read access for all approved users (market data is needed for portfolio calculations)
CREATE POLICY "Approved users can view securities"
ON public.securities FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));