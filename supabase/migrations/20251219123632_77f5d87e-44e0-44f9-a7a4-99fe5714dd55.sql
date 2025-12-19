-- Department Heads can view salaries of employees in their department
CREATE POLICY "Department heads can view their department salaries"
ON public.employee_salaries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM profiles p
    JOIN departments d ON d.id = p.department_id
    JOIN employees e_salary ON e_salary.department = d.name
    WHERE p.id = auth.uid()
      AND p.is_department_head = true
      AND p.is_approved = true
      AND e_salary.employee_id = employee_salaries.employee_id
  )
);

-- Branch Managers can view salaries of employees they manage
CREATE POLICY "Branch managers can view their team salaries"
ON public.employee_salaries
FOR SELECT
USING (
  has_role(auth.uid(), 'branch_manager'::app_role)
  AND EXISTS (
    SELECT 1 
    FROM employees e_salary
    JOIN employees e_manager ON e_salary.manager = e_manager.name
    WHERE e_salary.employee_id = employee_salaries.employee_id
      AND LOWER(e_manager.email) = LOWER(auth.jwt() ->> 'email')
  )
);