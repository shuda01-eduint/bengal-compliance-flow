-- Insert the department
INSERT INTO public.departments (name)
VALUES ('Extension of Head Office - DSE Tower, Nikunja')
ON CONFLICT DO NOTHING;

-- Update Atiqur's profile to be department head
UPDATE public.profiles
SET 
  is_department_head = true,
  department_id = (SELECT id FROM public.departments WHERE name = 'Extension of Head Office - DSE Tower, Nikunja')
WHERE email = 'mdatiqur.rahman@ucbstock.com.bd';

-- Recreate the function to use employees table for department matching
CREATE OR REPLACE FUNCTION public.is_department_head_of_rm(_rm_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles AS head
    JOIN public.departments AS dept ON dept.id = head.department_id
    JOIN public.employees AS rm_emp ON rm_emp.department = dept.name
    WHERE head.id = auth.uid()
      AND head.is_department_head = true
      AND head.is_approved = true
      AND LOWER(rm_emp.email) = LOWER(_rm_email)
  )
$$;