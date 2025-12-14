-- Create table for storing parsed trade data
CREATE TABLE public.trade_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT,
  status TEXT,
  isin TEXT,
  asset_class TEXT,
  order_id TEXT,
  ref_order_id TEXT,
  side TEXT,
  boid TEXT,
  security_code TEXT,
  board TEXT,
  trade_date TEXT,
  trade_time TEXT,
  quantity INTEGER DEFAULT 0,
  price NUMERIC DEFAULT 0,
  value NUMERIC DEFAULT 0,
  exec_id TEXT,
  session TEXT,
  fill_type TEXT,
  category TEXT,
  compulsory_spot TEXT,
  client_code TEXT,
  trader_dealer_id TEXT,
  owner_dealer_id TEXT,
  trade_report_type TEXT,
  file_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.trade_history ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert and view trade history
CREATE POLICY "Anyone can insert trade history"
ON public.trade_history
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can view trade history"
ON public.trade_history
FOR SELECT
USING (true);

-- Create index for common queries
CREATE INDEX idx_trade_history_client_code ON public.trade_history(client_code);
CREATE INDEX idx_trade_history_trade_date ON public.trade_history(trade_date);
CREATE INDEX idx_trade_history_uploaded_at ON public.trade_history(uploaded_at);