-- Add change and change_percent columns to securities table for storing price changes
ALTER TABLE public.securities ADD COLUMN IF NOT EXISTS change numeric DEFAULT 0;
ALTER TABLE public.securities ADD COLUMN IF NOT EXISTS change_percent numeric DEFAULT 0;

COMMENT ON COLUMN public.securities.change IS 'Price change from previous close';
COMMENT ON COLUMN public.securities.change_percent IS 'Percentage price change from previous close';