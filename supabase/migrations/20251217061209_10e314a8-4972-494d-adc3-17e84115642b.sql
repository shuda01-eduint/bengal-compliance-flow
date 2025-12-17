-- Improve keyset pagination performance for balances_raw (date filter + id ordering)
CREATE INDEX IF NOT EXISTS idx_balances_raw_date_id ON public.balances_raw(as_of_date, id);