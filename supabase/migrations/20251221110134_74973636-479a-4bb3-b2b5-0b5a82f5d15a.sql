-- Create table to track EOD run history
CREATE TABLE public.eod_run_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL,
  run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  run_by UUID REFERENCES auth.users(id),
  run_by_email TEXT,
  clients_captured INTEGER NOT NULL DEFAULT 0,
  total_ledger_balance NUMERIC NOT NULL DEFAULT 0,
  trade_files_count INTEGER DEFAULT 0,
  deposit_records_count INTEGER DEFAULT 0,
  total_deposits NUMERIC DEFAULT 0,
  total_withdrawals NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.eod_run_history ENABLE ROW LEVEL SECURITY;

-- Admins can manage EOD run history
CREATE POLICY "Admins can manage eod_run_history"
ON public.eod_run_history
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view EOD run history
CREATE POLICY "Approved users can view eod_run_history"
ON public.eod_run_history
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Create index for faster queries
CREATE INDEX idx_eod_run_history_date ON public.eod_run_history(run_date DESC);

-- Create function to get deposit/withdrawal import stats
CREATE OR REPLACE FUNCTION public.get_deposit_import_stats()
RETURNS TABLE(
  transaction_date DATE,
  deposit_count BIGINT,
  withdrawal_count BIGINT,
  total_deposits NUMERIC,
  total_withdrawals NUMERIC,
  first_upload TIMESTAMP WITH TIME ZONE,
  last_upload TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    dw.transaction_date,
    COUNT(*) FILTER (WHERE UPPER(dw.transaction_type) = 'DEPOSIT') as deposit_count,
    COUNT(*) FILTER (WHERE UPPER(dw.transaction_type) = 'WITHDRAWAL') as withdrawal_count,
    COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'DEPOSIT' THEN dw.amount ELSE 0 END), 0) as total_deposits,
    COALESCE(SUM(CASE WHEN UPPER(dw.transaction_type) = 'WITHDRAWAL' THEN dw.amount ELSE 0 END), 0) as total_withdrawals,
    MIN(dw.uploaded_at) as first_upload,
    MAX(dw.uploaded_at) as last_upload
  FROM deposits_withdrawals dw
  GROUP BY dw.transaction_date
  ORDER BY dw.transaction_date DESC;
$$;