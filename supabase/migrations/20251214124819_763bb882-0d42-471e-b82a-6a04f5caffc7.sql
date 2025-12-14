-- Create holdings table for inventory management
CREATE TABLE public.holdings (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    trading_code text NOT NULL,
    investor_code text NOT NULL,
    boid text,
    investor_name text,
    total_stock integer DEFAULT 0,
    saleable integer DEFAULT 0,
    avg_cost numeric DEFAULT 0,
    total_cost numeric DEFAULT 0,
    market_value numeric DEFAULT 0,
    ledger_balance numeric DEFAULT 0,
    rm_email text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

-- Policy for admins to manage all holdings
CREATE POLICY "Admins can manage all holdings" 
ON public.holdings 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Policy for authenticated users to view their own holdings by RM email
CREATE POLICY "RMs can view their own holdings" 
ON public.holdings 
FOR SELECT 
TO authenticated
USING (rm_email = auth.jwt() ->> 'email');

-- Trigger for updated_at
CREATE TRIGGER update_holdings_updated_at
BEFORE UPDATE ON public.holdings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_holdings_rm_email ON public.holdings(rm_email);
CREATE INDEX idx_holdings_investor_code ON public.holdings(investor_code);
CREATE INDEX idx_holdings_trading_code ON public.holdings(trading_code);