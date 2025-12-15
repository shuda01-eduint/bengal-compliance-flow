-- Create agent_trade_details table to store agent trade information
CREATE TABLE public.agent_trade_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_code TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  rm_id TEXT NOT NULL,
  rm_name TEXT,
  turnover NUMERIC DEFAULT 0,
  gross_commission NUMERIC DEFAULT 0,
  laga_howla NUMERIC DEFAULT 0,
  ait NUMERIC DEFAULT 0,
  net_commission NUMERIC DEFAULT 0,
  net_commission_without_ait_cdbl NUMERIC DEFAULT 0,
  cdbl_charge NUMERIC DEFAULT 0,
  commission_rate NUMERIC DEFAULT 0,
  comp_portion_gross_comm NUMERIC DEFAULT 0,
  company_profit NUMERIC DEFAULT 0,
  comm_associates_portion NUMERIC DEFAULT 0,
  upload_month TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_trade_details ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Admins can manage agent_trade_details"
ON public.agent_trade_details
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view agent_trade_details"
ON public.agent_trade_details
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Create indexes for performance
CREATE INDEX idx_agent_trade_details_rm_id ON public.agent_trade_details(rm_id);
CREATE INDEX idx_agent_trade_details_agent_id ON public.agent_trade_details(agent_id);
CREATE INDEX idx_agent_trade_details_upload_month ON public.agent_trade_details(upload_month);