-- Create helper function to check if user is HR or CEO Office staff
CREATE OR REPLACE FUNCTION public.is_hr_or_ceo()
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
      AND e.department IN ('HR', 'CEO Office')
  )
$$;

-- Drop the overly permissive policy that allows all approved users to view employees
DROP POLICY IF EXISTS "Approved users can view employees" ON public.employees;

-- Create new restricted policy for HR and CEO Office staff only
CREATE POLICY "HR and CEO Office can view employees"
ON public.employees
FOR SELECT
USING (is_hr_or_ceo());

-- Note: Admins (including COO) already have full access via "Admins can manage employees" policy