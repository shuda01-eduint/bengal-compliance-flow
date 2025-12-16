-- Add agent and RM fields to trade_history for denormalization
ALTER TABLE public.trade_history
ADD COLUMN IF NOT EXISTS agent_id text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS rm_id text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS rm_name text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS department text DEFAULT NULL;