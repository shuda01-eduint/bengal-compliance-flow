-- Add MANCOM access policies to commission_change_requests table
CREATE POLICY "MANCOM can view pending commission requests"
ON public.commission_change_requests
FOR SELECT
USING (
  (status = 'pending_manager') AND 
  is_mancom_of_rm(requested_by_email)
);

CREATE POLICY "MANCOM can approve pending commission requests"
ON public.commission_change_requests
FOR UPDATE
USING (
  (status = 'pending_manager') AND 
  is_mancom_of_rm(requested_by_email)
);

-- Add MANCOM access policies to assignment_change_requests table
CREATE POLICY "MANCOM can view pending assignment requests"
ON public.assignment_change_requests
FOR SELECT
USING (
  (status = 'pending_manager') AND 
  is_mancom_of_rm(requested_by_email)
);

CREATE POLICY "MANCOM can update pending assignment requests"
ON public.assignment_change_requests
FOR UPDATE
USING (
  (status = 'pending_manager') AND 
  is_mancom_of_rm(requested_by_email)
);