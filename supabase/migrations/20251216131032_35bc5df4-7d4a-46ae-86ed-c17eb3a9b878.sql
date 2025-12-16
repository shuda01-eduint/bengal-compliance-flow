-- Add rm_name and rm_id columns to balances_raw
ALTER TABLE public.balances_raw 
ADD COLUMN rm_name text,
ADD COLUMN rm_id text;

-- Add index for rm_id lookups
CREATE INDEX idx_balances_raw_rm_id ON public.balances_raw(rm_id);
CREATE INDEX idx_balances_raw_rm_name ON public.balances_raw(rm_name);