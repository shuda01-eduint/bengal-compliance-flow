-- Remove the overly permissive policy that allows all approved users to see all clients
DROP POLICY IF EXISTS "Approved users can view clients" ON public.clients;