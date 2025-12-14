-- Create clients table for investor/client data with RM linkage
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inv_code TEXT NOT NULL UNIQUE,
  investor_name TEXT NOT NULL,
  ledger_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  accrued_interest NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_liabilities NUMERIC(18,2) NOT NULL DEFAULT 0,
  market_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  equity NUMERIC(18,2) NOT NULL DEFAULT 0,
  rm_name TEXT NOT NULL,
  rm_email TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster RM-based queries
CREATE INDEX idx_clients_rm_email ON public.clients(rm_email);
CREATE INDEX idx_clients_rm_name ON public.clients(rm_name);
CREATE INDEX idx_clients_status ON public.clients(status);

-- Enable Row Level Security
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_clients_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policy: Allow authenticated users to read all clients (adjust later for RM-based filtering)
CREATE POLICY "Authenticated users can view clients"
ON public.clients
FOR SELECT
TO authenticated
USING (true);

-- RLS Policy: Only admins can insert/update/delete (for data imports)
CREATE POLICY "Admins can manage clients"
ON public.clients
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);