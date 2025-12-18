-- Create commission_change_requests table
CREATE TABLE public.commission_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  investor_name TEXT,
  current_commission NUMERIC,
  requested_commission NUMERIC NOT NULL,
  reason TEXT,
  requested_by UUID REFERENCES auth.users(id) NOT NULL,
  requested_by_email TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(),
  
  -- Manager (Dept Head/Branch Manager) approval
  manager_approved_by UUID REFERENCES auth.users(id),
  manager_approved_at TIMESTAMPTZ,
  manager_notes TEXT,
  
  -- Admin final approval
  admin_approved_by UUID REFERENCES auth.users(id),
  admin_approved_at TIMESTAMPTZ,
  admin_notes TEXT,
  
  -- Status: pending_manager → pending_admin → approved/rejected
  status TEXT NOT NULL DEFAULT 'pending_manager',
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.commission_change_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view their own requests
CREATE POLICY "Users can view own requests" 
ON public.commission_change_requests
FOR SELECT 
USING (requested_by = auth.uid());

-- Department Heads can view pending_manager requests (using profiles.is_department_head)
CREATE POLICY "Department heads can view pending requests" 
ON public.commission_change_requests
FOR SELECT 
USING (
  status = 'pending_manager' AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_department_head = true 
    AND profiles.is_approved = true
  )
);

-- Admins can view all requests
CREATE POLICY "Admins can view all requests" 
ON public.commission_change_requests
FOR SELECT 
USING (has_role(auth.uid(), 'admin'));

-- Approved users can create requests
CREATE POLICY "Approved users can create requests" 
ON public.commission_change_requests
FOR INSERT 
WITH CHECK (
  auth.uid() = requested_by AND
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_approved = true
  )
);

-- Department Heads can update pending_manager requests
CREATE POLICY "Department heads can approve pending requests" 
ON public.commission_change_requests
FOR UPDATE 
USING (
  status = 'pending_manager' AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_department_head = true 
    AND profiles.is_approved = true
  )
);

-- Admins can update any request
CREATE POLICY "Admins can update requests" 
ON public.commission_change_requests
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'));

-- Admins can delete requests
CREATE POLICY "Admins can delete requests" 
ON public.commission_change_requests
FOR DELETE 
USING (has_role(auth.uid(), 'admin'));

-- Create trigger function to update investor commission on approval
CREATE OR REPLACE FUNCTION public.update_investor_commission()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE public.investors 
    SET brokerage_commission = NEW.requested_commission,
        updated_at = now()
    WHERE investor_code = NEW.investor_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger
CREATE TRIGGER on_commission_approved
AFTER UPDATE ON public.commission_change_requests
FOR EACH ROW EXECUTE FUNCTION public.update_investor_commission();

-- Create trigger to update updated_at
CREATE TRIGGER update_commission_requests_updated_at
BEFORE UPDATE ON public.commission_change_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for faster lookups
CREATE INDEX idx_commission_requests_status ON public.commission_change_requests(status);
CREATE INDEX idx_commission_requests_investor ON public.commission_change_requests(investor_code);
CREATE INDEX idx_commission_requests_requested_by ON public.commission_change_requests(requested_by);