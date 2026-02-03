-- Add trade_count column to securities table for storing number of trades per stock
ALTER TABLE public.securities ADD COLUMN IF NOT EXISTS trade_count integer DEFAULT 0;

-- Add value column for storing total traded value per stock
ALTER TABLE public.securities ADD COLUMN IF NOT EXISTS value numeric DEFAULT 0;

COMMENT ON COLUMN public.securities.trade_count IS 'Number of trades executed for this security on the trading day';
COMMENT ON COLUMN public.securities.value IS 'Total traded value (price * volume) for this security';