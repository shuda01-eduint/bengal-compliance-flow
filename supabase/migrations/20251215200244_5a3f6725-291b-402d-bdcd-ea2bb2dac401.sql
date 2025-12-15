-- Create employees table
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  department TEXT NOT NULL,
  branch TEXT NOT NULL,
  joining_date DATE NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  manager TEXT,
  bank_account TEXT,
  serial_number INTEGER,
  date_of_confirmation DATE,
  date_of_promotion DATE,
  date_of_birth DATE,
  service_year INTEGER,
  service_month INTEGER,
  service_date INTEGER,
  increment_date DATE,
  release_date DATE,
  performance_2019 TEXT,
  performance_2020 TEXT,
  religion TEXT,
  employment_category TEXT,
  marital_status TEXT,
  upay_number TEXT,
  personal_phone TEXT,
  corporate_phone TEXT,
  nid_number TEXT,
  father_name TEXT,
  mother_name TEXT,
  spouse_name TEXT,
  blood_group TEXT,
  old_email TEXT,
  tin_number TEXT,
  functional_designation TEXT,
  category TEXT,
  gender TEXT,
  nationality TEXT DEFAULT 'Bangladeshi',
  present_address TEXT,
  permanent_address TEXT,
  passport_number TEXT,
  highest_degree TEXT,
  employment_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Admins can manage, approved users can view
CREATE POLICY "Admins can manage employees" 
ON public.employees 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view employees" 
ON public.employees 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Add foreign key from employee_salaries to employees
ALTER TABLE public.employee_salaries 
ADD CONSTRAINT employee_salaries_employee_id_fkey 
FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);

-- Create index for faster lookups
CREATE INDEX idx_employees_employee_id ON public.employees(employee_id);
CREATE INDEX idx_employees_department ON public.employees(department);
CREATE INDEX idx_employees_branch ON public.employees(branch);