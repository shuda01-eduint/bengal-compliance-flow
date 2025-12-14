-- Create departments table
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- Add department fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN department_id uuid REFERENCES public.departments(id),
ADD COLUMN is_department_head boolean NOT NULL DEFAULT false;

-- Create policy for viewing departments (authenticated users can view)
CREATE POLICY "Authenticated users can view departments" ON public.departments
FOR SELECT TO authenticated
USING (true);

-- Admins can manage departments
CREATE POLICY "Admins can manage departments" ON public.departments
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Create a function to check if user is department head of a specific RM's department
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
    JOIN public.profiles AS rm ON rm.department_id = head.department_id
    WHERE head.id = auth.uid()
      AND head.is_department_head = true
      AND head.is_approved = true
      AND rm.email = _rm_email
  )
$$;

-- Add policy for department heads to view their team's clients
CREATE POLICY "Department heads can view team clients" ON public.clients
FOR SELECT TO authenticated
USING (
  is_department_head_of_rm(rm_email)
);