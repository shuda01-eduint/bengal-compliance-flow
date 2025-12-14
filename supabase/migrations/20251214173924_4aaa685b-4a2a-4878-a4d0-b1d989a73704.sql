
-- Drop existing overly permissive policies on trade_history
DROP POLICY IF EXISTS "Anyone can view trade history" ON public.trade_history;
DROP POLICY IF EXISTS "Anyone can insert trade history" ON public.trade_history;

-- Create proper RLS policies for trade_history
CREATE POLICY "Admins can manage trade history" ON public.trade_history
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "RMs can view their client trades" ON public.trade_history
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.inv_code = trade_history.client_code
    AND c.rm_email = (auth.jwt() ->> 'email')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
  )
);

CREATE POLICY "Department heads can view team trades" ON public.trade_history
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.inv_code = trade_history.client_code
    AND is_department_head_of_rm(c.rm_email)
  )
);

-- Drop existing overly permissive policies on portfolios
DROP POLICY IF EXISTS "Anyone can view portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Anyone can manage portfolios" ON public.portfolios;

-- Create proper RLS policies for portfolios
CREATE POLICY "Admins can manage portfolios" ON public.portfolios
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "RMs can view their portfolios" ON public.portfolios
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.inv_code = portfolios.investor_code
    AND c.rm_email = (auth.jwt() ->> 'email')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
  )
);

CREATE POLICY "Department heads can view team portfolios" ON public.portfolios
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.inv_code = portfolios.investor_code
    AND is_department_head_of_rm(c.rm_email)
  )
);

-- Drop existing overly permissive policies on portfolio_custom_fields
DROP POLICY IF EXISTS "Anyone can view custom fields" ON public.portfolio_custom_fields;
DROP POLICY IF EXISTS "Anyone can manage custom fields" ON public.portfolio_custom_fields;

-- Create proper RLS policies for portfolio_custom_fields
CREATE POLICY "Admins can manage custom fields" ON public.portfolio_custom_fields
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view custom fields" ON public.portfolio_custom_fields
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true));

-- Drop existing overly permissive policies on portfolio_field_values
DROP POLICY IF EXISTS "Anyone can view field values" ON public.portfolio_field_values;
DROP POLICY IF EXISTS "Anyone can manage field values" ON public.portfolio_field_values;

-- Create proper RLS policies for portfolio_field_values
CREATE POLICY "Admins can manage field values" ON public.portfolio_field_values
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view field values" ON public.portfolio_field_values
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true));

-- Drop existing overly permissive policies on deposits_withdrawals
DROP POLICY IF EXISTS "Anyone can view deposits_withdrawals" ON public.deposits_withdrawals;
DROP POLICY IF EXISTS "Anyone can insert deposits_withdrawals" ON public.deposits_withdrawals;
DROP POLICY IF EXISTS "Anyone can delete deposits_withdrawals" ON public.deposits_withdrawals;

-- Create proper RLS policies for deposits_withdrawals
CREATE POLICY "Admins can manage deposits_withdrawals" ON public.deposits_withdrawals
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "RMs can view their deposits_withdrawals" ON public.deposits_withdrawals
FOR SELECT TO authenticated
USING (
  rm_email = (auth.jwt() ->> 'email')
  AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
);

CREATE POLICY "Department heads can view team deposits_withdrawals" ON public.deposits_withdrawals
FOR SELECT TO authenticated
USING (is_department_head_of_rm(rm_email));

-- Drop existing overly permissive policies on agent_codes
DROP POLICY IF EXISTS "Anyone can view agent codes" ON public.agent_codes;
DROP POLICY IF EXISTS "Anyone can insert agent codes" ON public.agent_codes;

-- Create proper RLS policies for agent_codes
CREATE POLICY "Admins can manage agent codes" ON public.agent_codes
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view agent codes" ON public.agent_codes
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true));
