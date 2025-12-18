-- Create agents master table
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  commission_rate NUMERIC DEFAULT 0.25,
  bank_account TEXT,
  routing_number TEXT,
  bank_name TEXT,
  tin_number TEXT,
  nid_number TEXT,
  rm_id TEXT NOT NULL,
  rm_name TEXT,
  status TEXT DEFAULT 'Active',
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Admins can manage agents
CREATE POLICY "Admins can manage agents"
ON public.agents
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Approved users can view agents
CREATE POLICY "Approved users can view agents"
ON public.agents
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Create trigger for updated_at
CREATE TRIGGER update_agents_updated_at
BEFORE UPDATE ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();