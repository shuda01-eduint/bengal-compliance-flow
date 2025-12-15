-- Create merchant_banks table for prefix to name mappings
CREATE TABLE public.merchant_banks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.merchant_banks ENABLE ROW LEVEL SECURITY;

-- Admins can manage merchant banks
CREATE POLICY "Admins can manage merchant_banks"
ON public.merchant_banks
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view merchant banks
CREATE POLICY "Approved users can view merchant_banks"
ON public.merchant_banks
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Add trigger for updated_at
CREATE TRIGGER update_merchant_banks_updated_at
BEFORE UPDATE ON public.merchant_banks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default bank mappings
INSERT INTO public.merchant_banks (prefix, bank_name, description) VALUES
  ('CL', 'Community Bank Investment', 'Community Bank client accounts'),
  ('CM', 'Commercial Merchant Bank', 'Commercial merchant accounts'),
  ('CN', 'Central National Bank', 'Central National Bank accounts'),
  ('N', 'National Bank', 'National Bank accounts');