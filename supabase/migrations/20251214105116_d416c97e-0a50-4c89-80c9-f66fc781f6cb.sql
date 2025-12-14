-- Create agent_codes table to store agent codes under RMs
CREATE TABLE public.agent_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_code TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  rm_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.agent_codes ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing
CREATE POLICY "Anyone can view agent codes" 
ON public.agent_codes 
FOR SELECT 
USING (true);

-- Create policy for insert (admin)
CREATE POLICY "Anyone can insert agent codes" 
ON public.agent_codes 
FOR INSERT 
WITH CHECK (true);

-- Create index on rm_id for faster grouping
CREATE INDEX idx_agent_codes_rm_id ON public.agent_codes(rm_id);

-- Create unique constraint to prevent duplicates
ALTER TABLE public.agent_codes ADD CONSTRAINT unique_investor_agent UNIQUE (investor_code, agent_id);