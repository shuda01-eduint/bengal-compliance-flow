-- Add department head policy for holdings (matching other tables)
CREATE POLICY "Department heads can view team holdings"
ON public.holdings
FOR SELECT
USING (is_department_head_of_rm(rm_email));