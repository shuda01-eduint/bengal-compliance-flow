-- Drop and recreate admin_balances table with new schema
-- First, drop the existing table
DROP TABLE IF EXISTS public.admin_balances;

-- Create the new admin_balances table with updated columns
CREATE TABLE public.admin_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  investor_code TEXT NOT NULL,
  boid TEXT,
  instrument TEXT,
  investor_name TEXT,
  total_stock NUMERIC,
  saleable NUMERIC,
  avg_cost NUMERIC,
  total_cost NUMERIC,
  total_mv NUMERIC,
  ledger_balance NUMERIC,
  matured_balance NUMERIC,
  receivable_sales NUMERIC,
  cheque_in_tran_hand NUMERIC,
  rm TEXT,
  rm_id TEXT,
  rm_email TEXT,
  department TEXT,
  commission_rate NUMERIC,
  charge_rate NUMERIC,
  account_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for common queries
CREATE INDEX idx_admin_balances_as_of_date ON public.admin_balances(as_of_date);
CREATE INDEX idx_admin_balances_investor_code ON public.admin_balances(investor_code);
CREATE INDEX idx_admin_balances_rm_email ON public.admin_balances(rm_email);

-- Enable RLS
ALTER TABLE public.admin_balances ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Admin balances viewable by authenticated users"
ON public.admin_balances
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Admin balances insertable by authenticated users"
ON public.admin_balances
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin balances updatable by authenticated users"
ON public.admin_balances
FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Admin balances deletable by authenticated users"
ON public.admin_balances
FOR DELETE
USING (auth.role() = 'authenticated');

-- Add comment for documentation
COMMENT ON TABLE public.admin_balances IS 'Stores admin balance baseline data imported from external systems';