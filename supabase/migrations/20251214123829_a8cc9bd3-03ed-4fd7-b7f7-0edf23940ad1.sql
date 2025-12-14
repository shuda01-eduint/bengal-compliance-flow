-- Create securities table for storing stock/security data
CREATE TABLE public.securities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trading_code TEXT NOT NULL,
  close_price NUMERIC,
  volume BIGINT,
  category TEXT,
  audited_pe NUMERIC,
  eps NUMERIC,
  instrument_type TEXT,
  total_securities BIGINT,
  director_percent NUMERIC,
  govt_percent NUMERIC,
  institute_percent NUMERIC,
  foreign_percent NUMERIC,
  public_percent NUMERIC,
  sector TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.securities ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (similar to trade_history)
CREATE POLICY "Anyone can view securities" 
ON public.securities 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert securities" 
ON public.securities 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update securities" 
ON public.securities 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete securities" 
ON public.securities 
FOR DELETE 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_securities_updated_at
BEFORE UPDATE ON public.securities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();