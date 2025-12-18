-- Create table for investor RM assignments
CREATE TABLE public.investor_rm_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  rm_email TEXT NOT NULL,
  rm_name TEXT,
  department TEXT,
  percentage NUMERIC NOT NULL DEFAULT 100 CHECK (percentage > 0 AND percentage <= 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(investor_code, rm_email)
);

-- Create table for investor agent assignments
CREATE TABLE public.investor_agent_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  percentage NUMERIC NOT NULL DEFAULT 100 CHECK (percentage > 0 AND percentage <= 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(investor_code, agent_id)
);

-- Create table for assignment change requests (RM and Agent changes)
CREATE TABLE public.assignment_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  investor_name TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('rm', 'agent')),
  current_assignments JSONB DEFAULT '[]'::jsonb,
  requested_assignments JSONB NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_manager' CHECK (status IN ('pending_manager', 'pending_admin', 'approved', 'rejected')),
  requested_by UUID NOT NULL,
  requested_by_email TEXT NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  manager_approved_by UUID,
  manager_approved_at TIMESTAMP WITH TIME ZONE,
  manager_notes TEXT,
  admin_approved_by UUID,
  admin_approved_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  rejected_by UUID,
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.investor_rm_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_change_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies for investor_rm_assignments
CREATE POLICY "Admins can manage rm assignments"
ON public.investor_rm_assignments FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view rm assignments"
ON public.investor_rm_assignments FOR SELECT
USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- RLS policies for investor_agent_assignments
CREATE POLICY "Admins can manage agent assignments"
ON public.investor_agent_assignments FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view agent assignments"
ON public.investor_agent_assignments FOR SELECT
USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- RLS policies for assignment_change_requests
CREATE POLICY "Users can view own assignment requests"
ON public.assignment_change_requests FOR SELECT
USING (requested_by = auth.uid());

CREATE POLICY "Department heads can view pending assignment requests"
ON public.assignment_change_requests FOR SELECT
USING (status = 'pending_manager' AND EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() 
  AND profiles.is_department_head = true 
  AND profiles.is_approved = true
));

CREATE POLICY "Admins can view all assignment requests"
ON public.assignment_change_requests FOR SELECT
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can create assignment requests"
ON public.assignment_change_requests FOR INSERT
WITH CHECK (auth.uid() = requested_by AND EXISTS (
  SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

CREATE POLICY "Department heads can update pending assignment requests"
ON public.assignment_change_requests FOR UPDATE
USING (status = 'pending_manager' AND EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() 
  AND profiles.is_department_head = true 
  AND profiles.is_approved = true
));

CREATE POLICY "Admins can update assignment requests"
ON public.assignment_change_requests FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete assignment requests"
ON public.assignment_change_requests FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Trigger to update investor assignments when request is approved
CREATE OR REPLACE FUNCTION public.apply_assignment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    IF NEW.change_type = 'rm' THEN
      -- Delete existing RM assignments for this investor
      DELETE FROM public.investor_rm_assignments WHERE investor_code = NEW.investor_code;
      -- Insert new RM assignments
      INSERT INTO public.investor_rm_assignments (investor_code, rm_email, rm_name, department, percentage)
      SELECT 
        NEW.investor_code,
        (value->>'rm_email')::text,
        (value->>'rm_name')::text,
        (value->>'department')::text,
        (value->>'percentage')::numeric
      FROM jsonb_array_elements(NEW.requested_assignments);
    ELSIF NEW.change_type = 'agent' THEN
      -- Delete existing agent assignments for this investor
      DELETE FROM public.investor_agent_assignments WHERE investor_code = NEW.investor_code;
      -- Insert new agent assignments
      INSERT INTO public.investor_agent_assignments (investor_code, agent_id, agent_name, percentage)
      SELECT 
        NEW.investor_code,
        (value->>'agent_id')::text,
        (value->>'agent_name')::text,
        (value->>'percentage')::numeric
      FROM jsonb_array_elements(NEW.requested_assignments);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_assignment_approved
  AFTER UPDATE ON public.assignment_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_assignment_changes();

-- Trigger to update updated_at
CREATE TRIGGER update_rm_assignments_updated_at
  BEFORE UPDATE ON public.investor_rm_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_assignments_updated_at
  BEFORE UPDATE ON public.investor_agent_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_assignment_requests_updated_at
  BEFORE UPDATE ON public.assignment_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_rm_assignments_investor ON public.investor_rm_assignments(investor_code);
CREATE INDEX idx_agent_assignments_investor ON public.investor_agent_assignments(investor_code);
CREATE INDEX idx_assignment_requests_status ON public.assignment_change_requests(status);
CREATE INDEX idx_assignment_requests_investor ON public.assignment_change_requests(investor_code);