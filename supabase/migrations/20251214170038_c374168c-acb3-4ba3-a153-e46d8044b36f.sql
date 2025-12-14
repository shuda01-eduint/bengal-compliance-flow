-- Create deposits_withdrawals table for daily transactions
CREATE TABLE public.deposits_withdrawals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_code TEXT NOT NULL,
  investor_name TEXT,
  transaction_type TEXT NOT NULL, -- 'deposit' or 'withdrawal'
  amount NUMERIC NOT NULL DEFAULT 0,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  rm_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.deposits_withdrawals ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view deposits_withdrawals"
ON public.deposits_withdrawals
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert deposits_withdrawals"
ON public.deposits_withdrawals
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can delete deposits_withdrawals"
ON public.deposits_withdrawals
FOR DELETE
USING (true);

-- Create index for common queries
CREATE INDEX idx_deposits_withdrawals_investor ON public.deposits_withdrawals(investor_code);
CREATE INDEX idx_deposits_withdrawals_date ON public.deposits_withdrawals(transaction_date);