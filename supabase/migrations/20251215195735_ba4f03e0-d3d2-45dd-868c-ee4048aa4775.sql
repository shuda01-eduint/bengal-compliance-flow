-- Create employee_salaries table
CREATE TABLE public.employee_salaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT NOT NULL,
  basic_salary NUMERIC,
  house_rent NUMERIC,
  medical_allowance NUMERIC,
  transport_allowance NUMERIC,
  other_allowance NUMERIC,
  gross_salary NUMERIC,
  tax_deduction NUMERIC,
  pf_deduction NUMERIC,
  other_deduction NUMERIC,
  net_salary NUMERIC,
  bank_account TEXT,
  payment_method TEXT DEFAULT 'Bank Transfer',
  effective_from DATE,
  effective_to DATE,
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Only admins can manage salary data (sensitive)
CREATE POLICY "Admins can manage employee salaries" 
ON public.employee_salaries 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view salaries (department heads, etc.)
CREATE POLICY "Approved users can view employee salaries" 
ON public.employee_salaries 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));