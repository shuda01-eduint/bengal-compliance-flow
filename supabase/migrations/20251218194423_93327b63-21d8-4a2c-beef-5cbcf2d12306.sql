-- Fix stock exchange uploads: remove legacy uniqueness on (exec_id, trade_date)
-- This legacy index can block valid re-uploads where exec_id is reused across different clients.

-- In case the old constraint still exists in any environment
ALTER TABLE public.trade_history
DROP CONSTRAINT IF EXISTS trade_history_exec_id_trade_date_key;

-- Drop the legacy unique index (the main blocker seen in logs)
DROP INDEX IF EXISTS public.idx_trade_history_exec_id_trade_date_unique;
