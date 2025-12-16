-- Add net_deposit column to trade_history for denormalized deposit/withdrawal data
ALTER TABLE public.trade_history 
ADD COLUMN IF NOT EXISTS total_deposits numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_withdrawals numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS net_deposit numeric DEFAULT 0;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_trade_history_net_deposit ON public.trade_history(net_deposit);