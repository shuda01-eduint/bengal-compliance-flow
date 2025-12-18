-- Drop the overly permissive policy that allows all approved users to view salaries
DROP POLICY IF EXISTS "Approved users can view employee salaries" ON public.employee_salaries;

-- Add policy for MANCOM members to view employee salaries
CREATE POLICY "MANCOM can view employee salaries"
ON public.employee_salaries
FOR SELECT
USING (has_role(auth.uid(), 'mancom'::app_role));

-- Note: Admins already have full access via "Admins can manage employee salaries" policy