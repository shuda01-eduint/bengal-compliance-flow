-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can view clients" ON public.clients;

-- Drop the existing admin policy that uses true
DROP POLICY IF EXISTS "Admins can manage clients" ON public.clients;

-- Create proper admin policy with role check
CREATE POLICY "Admins can manage clients" ON public.clients
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Create policy for approved RMs to view their own clients
CREATE POLICY "Approved RMs can view their clients" ON public.clients
FOR SELECT
TO authenticated
USING (
  rm_email = (auth.jwt() ->> 'email')
  AND EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND is_approved = true
  )
);

-- Create policy for approved users to view clients (for general access if needed)
CREATE POLICY "Approved users can view clients" ON public.clients
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND is_approved = true
  )
  AND has_role(auth.uid(), 'user')
);