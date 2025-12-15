-- Add index on client_code to speed up RLS policy joins with clients table
CREATE INDEX IF NOT EXISTS idx_trade_history_client_code ON public.trade_history(client_code);

-- Add index on uploaded_at for faster ordering
CREATE INDEX IF NOT EXISTS idx_trade_history_uploaded_at ON public.trade_history(uploaded_at DESC);

-- Add composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_trade_history_filters ON public.trade_history(side, file_name, trade_date);

-- Add index on clients inv_code and rm_email for faster RLS policy checks
CREATE INDEX IF NOT EXISTS idx_clients_inv_code ON public.clients(inv_code);
CREATE INDEX IF NOT EXISTS idx_clients_rm_email ON public.clients(rm_email);