-- Create securities_margin_prices table for daily margin list and price imports
CREATE TABLE public.securities_margin_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker text NOT NULL,
  close_price numeric NOT NULL DEFAULT 0,
  remarks text,
  is_marginable boolean NOT NULL DEFAULT true,
  price_date date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(ticker, price_date)
);

-- Create index for common queries
CREATE INDEX idx_securities_margin_prices_date ON public.securities_margin_prices(price_date);
CREATE INDEX idx_securities_margin_prices_ticker ON public.securities_margin_prices(ticker);

-- Enable RLS
ALTER TABLE public.securities_margin_prices ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage securities_margin_prices"
ON public.securities_margin_prices
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view securities_margin_prices"
ON public.securities_margin_prices
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Also update instrument table when importing (trigger to sync marginability)
CREATE OR REPLACE FUNCTION public.sync_instrument_marginability()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the instrument table with marginability info
  UPDATE public.instrument
  SET 
    is_marginable = NEW.is_marginable,
    category = CASE 
      WHEN NEW.remarks ILIKE '%Z-Category%' THEN 'Z'
      WHEN NEW.remarks ILIKE '%B-Category%' THEN 'B'
      WHEN NEW.remarks ILIKE '%N-Category%' THEN 'N'
      WHEN NEW.remarks ILIKE '%G-Category%' THEN 'G'
      ELSE COALESCE(category, 'A')
    END,
    updated_at = now()
  WHERE trading_code = NEW.ticker;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER sync_instrument_on_margin_price_insert
AFTER INSERT OR UPDATE ON public.securities_margin_prices
FOR EACH ROW
EXECUTE FUNCTION public.sync_instrument_marginability();

-- Update instrument_prices_eod with the close price
CREATE OR REPLACE FUNCTION public.sync_instrument_price_eod()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.instrument_prices_eod (instrument, trade_date, eod_price)
  VALUES (NEW.ticker, NEW.price_date, NEW.close_price)
  ON CONFLICT (instrument, trade_date) 
  DO UPDATE SET eod_price = EXCLUDED.eod_price;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER sync_price_eod_on_margin_price_insert
AFTER INSERT OR UPDATE ON public.securities_margin_prices
FOR EACH ROW
EXECUTE FUNCTION public.sync_instrument_price_eod();