-- Create investors table for comprehensive investor information
CREATE TABLE public.investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code text NOT NULL UNIQUE,
  investor_name text NOT NULL,
  investor_type text,
  bo_id text,
  father_spouse_name text,
  mother_name text,
  home_address text,
  date_of_birth date,
  cell_no text,
  email text,
  account_open_date date,
  bank_account_no text,
  bank_name text,
  bank_branch text,
  status text DEFAULT 'Active',
  trader text,
  account_type text,
  interest_rate numeric DEFAULT 0,
  brokerage_commission numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

-- Admin can manage all investor records
CREATE POLICY "Admins can manage investors" ON public.investors
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view investors
CREATE POLICY "Approved users can view investors" ON public.investors
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true)
  );

-- Create updated_at trigger
CREATE TRIGGER update_investors_updated_at
  BEFORE UPDATE ON public.investors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for faster searches
CREATE INDEX idx_investors_investor_code ON public.investors(investor_code);
CREATE INDEX idx_investors_investor_name ON public.investors(investor_name);
CREATE INDEX idx_investors_status ON public.investors(status);