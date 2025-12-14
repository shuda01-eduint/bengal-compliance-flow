-- Drop the existing authenticated-only policy
DROP POLICY IF EXISTS "Authenticated users can view clients" ON public.clients;

-- Create a new policy that allows public read access
CREATE POLICY "Anyone can view clients"
ON public.clients
FOR SELECT
USING (true);