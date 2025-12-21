-- Drop non-admin policies on investors table to restrict personal data access
DROP POLICY IF EXISTS "Department heads view limited investor data" ON public.investors;
DROP POLICY IF EXISTS "MANCOM view limited investor data" ON public.investors;
DROP POLICY IF EXISTS "RMs can view their assigned investors" ON public.investors;
DROP POLICY IF EXISTS "Settlement can view all investor data" ON public.investors;

-- Now only admins can access investor data (existing policy remains):
-- "Admins can manage investors" - ALL operations for admins