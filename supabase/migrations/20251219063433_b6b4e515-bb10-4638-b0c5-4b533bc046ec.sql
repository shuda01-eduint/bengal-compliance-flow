-- Create a table for reconciliation results
CREATE TABLE public.reconciliation_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inv_code TEXT NOT NULL,
  investor_name TEXT,
  rm_name TEXT,
  total_buy_value NUMERIC DEFAULT 0,
  total_sell_value NUMERIC DEFAULT 0,
  net_value NUMERIC DEFAULT 0,
  current_ledger_balance NUMERIC DEFAULT 0,
  status TEXT NOT NULL,
  issues TEXT[] DEFAULT '{}',
  reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_reconciliation_results_date ON public.reconciliation_results(reconciliation_date);
CREATE INDEX idx_reconciliation_results_inv_code ON public.reconciliation_results(inv_code);

-- Enable RLS
ALTER TABLE public.reconciliation_results ENABLE ROW LEVEL SECURITY;

-- Admins can manage reconciliation results
CREATE POLICY "Admins can manage reconciliation_results"
ON public.reconciliation_results
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view reconciliation results
CREATE POLICY "Approved users can view reconciliation_results"
ON public.reconciliation_results
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));