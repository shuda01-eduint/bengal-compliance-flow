-- Create branch_codes table for mapping prefixes to branch names
CREATE TABLE public.branch_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL,
  branch_type TEXT DEFAULT 'outlet',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.branch_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage branch_codes" 
ON public.branch_codes 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view branch_codes" 
ON public.branch_codes 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Migrate existing merchant_banks data to branch_codes
INSERT INTO public.branch_codes (prefix, branch_name, branch_type, description)
SELECT prefix, bank_name, 'outlet', description
FROM public.merchant_banks
ON CONFLICT (prefix) DO NOTHING;

-- Add trigger for updated_at
CREATE TRIGGER update_branch_codes_updated_at
BEFORE UPDATE ON public.branch_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();