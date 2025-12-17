-- Add indexes on balances_raw table for improved query performance
CREATE INDEX IF NOT EXISTS idx_balances_raw_as_of_date ON public.balances_raw(as_of_date);
CREATE INDEX IF NOT EXISTS idx_balances_raw_investor_code ON public.balances_raw(investor_code);
CREATE INDEX IF NOT EXISTS idx_balances_raw_rm_email ON public.balances_raw(rm_email);
CREATE INDEX IF NOT EXISTS idx_balances_raw_rm_id ON public.balances_raw(rm_id);

-- Composite index for common query pattern (date + investor filtering)
CREATE INDEX IF NOT EXISTS idx_balances_raw_date_investor ON public.balances_raw(as_of_date, investor_code);