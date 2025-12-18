-- Fix RLS policies on trade_history to be PERMISSIVE (allows access if ANY policy matches)
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "RMs can view their client trades" ON trade_history;
DROP POLICY IF EXISTS "Department heads can view team trades" ON trade_history;
DROP POLICY IF EXISTS "MANCOM can view team trades" ON trade_history;
DROP POLICY IF EXISTS "Admins can manage trade history" ON trade_history;

-- Recreate as PERMISSIVE policies
CREATE POLICY "Admins can manage trade history" 
ON trade_history 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "RMs can view their client trades" 
ON trade_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.inv_code = trade_history.client_code
      AND LOWER(c.rm_email) = LOWER(auth.jwt() ->> 'email')
      AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.is_approved = true
      )
  )
);

CREATE POLICY "Department heads can view team trades" 
ON trade_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.inv_code = trade_history.client_code
      AND is_department_head_of_rm(c.rm_email)
  )
);

CREATE POLICY "MANCOM can view team trades" 
ON trade_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clients c
    WHERE c.inv_code = trade_history.client_code
      AND is_mancom_of_rm(c.rm_email)
  )
);