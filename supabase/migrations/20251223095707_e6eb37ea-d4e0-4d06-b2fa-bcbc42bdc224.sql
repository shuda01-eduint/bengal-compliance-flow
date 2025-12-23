-- Allow approved users to insert opening balances
CREATE POLICY "Approved users can insert eod_ledger_snapshots" 
ON public.eod_ledger_snapshots
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_approved = true
  )
);

-- Allow approved users to delete eod_ledger_snapshots  
CREATE POLICY "Approved users can delete eod_ledger_snapshots"
ON public.eod_ledger_snapshots
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_approved = true
  )
);