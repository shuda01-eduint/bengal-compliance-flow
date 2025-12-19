-- Drop existing MANCOM policy that gives access to all salaries
DROP POLICY IF EXISTS "MANCOM can view employee salaries" ON public.employee_salaries;

-- Create new MANCOM policy restricted to their department only
CREATE POLICY "MANCOM can view their department salaries"
ON public.employee_salaries
FOR SELECT
USING (
  has_role(auth.uid(), 'mancom'::app_role)
  AND EXISTS (
    SELECT 1 
    FROM employees e_salary
    JOIN employees e_mancom ON e_salary.department = e_mancom.department
    WHERE e_salary.employee_id = employee_salaries.employee_id
      AND LOWER(e_mancom.email) = LOWER(auth.jwt() ->> 'email')
  )
);