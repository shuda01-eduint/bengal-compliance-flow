-- Create table to store EOD (End of Day) ledger balance snapshots
CREATE TABLE public.eod_ledger_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  eod_date DATE NOT NULL,
  investor_code TEXT NOT NULL,
  ledger_balance NUMERIC NOT NULL DEFAULT 0,
  investor_name TEXT,
  rm_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(eod_date, investor_code)
);

-- Enable RLS
ALTER TABLE public.eod_ledger_snapshots ENABLE ROW LEVEL SECURITY;

-- Admins can manage EOD snapshots
CREATE POLICY "Admins can manage eod_ledger_snapshots"
ON public.eod_ledger_snapshots
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view EOD snapshots
CREATE POLICY "Approved users can view eod_ledger_snapshots"
ON public.eod_ledger_snapshots
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Create index for faster queries
CREATE INDEX idx_eod_ledger_snapshots_date ON public.eod_ledger_snapshots(eod_date);
CREATE INDEX idx_eod_ledger_snapshots_investor ON public.eod_ledger_snapshots(investor_code);