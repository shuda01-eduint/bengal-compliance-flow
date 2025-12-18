-- Add MANCOM access policies to deposits_withdrawals table
CREATE POLICY "MANCOM can view team deposits_withdrawals"
ON public.deposits_withdrawals
FOR SELECT
USING (is_mancom_of_rm(rm_email));

-- Add MANCOM access policies to portfolios table
-- Portfolios link to clients via investor_code to find RM email
CREATE POLICY "MANCOM can view team portfolios"
ON public.portfolios
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = portfolios.investor_code
  AND is_mancom_of_rm(c.rm_email)
));