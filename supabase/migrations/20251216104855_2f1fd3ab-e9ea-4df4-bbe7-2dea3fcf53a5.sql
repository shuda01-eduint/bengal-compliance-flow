-- Create balances_raw table for per-instrument balance data
CREATE TABLE public.balances_raw (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  investor_code text NOT NULL,
  instrument text,
  total_stock integer DEFAULT 0,
  saleable integer DEFAULT 0,
  avg_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  total_mv numeric DEFAULT 0,
  ledger_balance numeric DEFAULT 0,
  matured_balance numeric DEFAULT 0,
  receivable_sale numeric DEFAULT 0,
  cq_in_transit numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_balances_raw_as_of_date ON public.balances_raw(as_of_date);
CREATE INDEX idx_balances_raw_investor_code ON public.balances_raw(investor_code);
CREATE INDEX idx_balances_raw_instrument ON public.balances_raw(instrument);
CREATE INDEX idx_balances_raw_date_investor ON public.balances_raw(as_of_date, investor_code);

-- Enable RLS
ALTER TABLE public.balances_raw ENABLE ROW LEVEL SECURITY;

-- Admins can manage balances_raw
CREATE POLICY "Admins can manage balances_raw"
ON public.balances_raw
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Department heads can view team balances
CREATE POLICY "Department heads can view balances_raw"
ON public.balances_raw
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.inv_code = balances_raw.investor_code
    AND is_department_head_of_rm(c.rm_email)
  )
);

-- RMs can view their client balances
CREATE POLICY "RMs can view their balances_raw"
ON public.balances_raw
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.inv_code = balances_raw.investor_code
    AND c.rm_email = (auth.jwt() ->> 'email'::text)
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    )
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_balances_raw_updated_at
BEFORE UPDATE ON public.balances_raw
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();