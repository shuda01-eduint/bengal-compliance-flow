-- Add MANCOM access policies to clients table
CREATE POLICY "MANCOM can view team clients"
ON public.clients
FOR SELECT
USING (is_mancom_of_rm(rm_email));

-- Add MANCOM access policies to balances_raw table
CREATE POLICY "MANCOM can view team balances_raw"
ON public.balances_raw
FOR SELECT
USING (is_mancom_of_rm(rm_email));

-- Add MANCOM access policies to holdings table
CREATE POLICY "MANCOM can view team holdings"
ON public.holdings
FOR SELECT
USING (is_mancom_of_rm(rm_email));

-- Add MANCOM access policies to trade_history table
-- Trade history uses client_code to find RM email via clients table
CREATE POLICY "MANCOM can view team trades"
ON public.trade_history
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clients c
  WHERE c.inv_code = trade_history.client_code
  AND is_mancom_of_rm(c.rm_email)
));