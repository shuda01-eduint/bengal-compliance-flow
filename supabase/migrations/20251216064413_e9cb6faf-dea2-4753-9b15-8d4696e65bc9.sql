-- Add denormalized investor/client fields to trade_history for fast queries
ALTER TABLE public.trade_history
ADD COLUMN IF NOT EXISTS brokerage_commission numeric DEFAULT NULL,
ADD COLUMN IF NOT EXISTS interest_rate numeric DEFAULT NULL,
ADD COLUMN IF NOT EXISTS account_type text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS investor_type text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ledger_balance_snapshot numeric DEFAULT NULL;

-- Create index for faster lookups on client_code
CREATE INDEX IF NOT EXISTS idx_trade_history_client_code ON public.trade_history(client_code);