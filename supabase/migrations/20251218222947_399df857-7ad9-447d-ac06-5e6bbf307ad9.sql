-- Create indexes to speed up common queries on balances_raw
CREATE INDEX IF NOT EXISTS idx_balances_raw_as_of_date ON public.balances_raw (as_of_date);
CREATE INDEX IF NOT EXISTS idx_balances_raw_as_of_date_id ON public.balances_raw (as_of_date, id);
CREATE INDEX IF NOT EXISTS idx_balances_raw_rm_email ON public.balances_raw (rm_email) WHERE rm_email IS NOT NULL;

-- Create a function to get distinct dates efficiently
CREATE OR REPLACE FUNCTION public.get_balance_dates()
RETURNS TABLE(as_of_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT br.as_of_date
  FROM public.balances_raw br
  ORDER BY br.as_of_date DESC;
$$;

-- Create a function to get distinct RMs efficiently  
CREATE OR REPLACE FUNCTION public.get_balance_rms()
RETURNS TABLE(rm_email text, rm_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT br.rm_email, MAX(br.rm_name) as rm_name
  FROM public.balances_raw br
  WHERE br.rm_email IS NOT NULL
  GROUP BY br.rm_email
  ORDER BY MAX(br.rm_name);
$$;