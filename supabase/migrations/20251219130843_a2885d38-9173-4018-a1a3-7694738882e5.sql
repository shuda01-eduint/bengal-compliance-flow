-- Add OHLC data columns
ALTER TABLE public.securities 
ADD COLUMN IF NOT EXISTS open_price numeric,
ADD COLUMN IF NOT EXISTS high_price numeric,
ADD COLUMN IF NOT EXISTS low_price numeric;

-- Add market cap column
ALTER TABLE public.securities 
ADD COLUMN IF NOT EXISTS market_cap numeric;

-- Add 52-week high/low columns
ALTER TABLE public.securities 
ADD COLUMN IF NOT EXISTS week_52_high numeric,
ADD COLUMN IF NOT EXISTS week_52_low numeric;

-- Add last synced timestamp
ALTER TABLE public.securities 
ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;