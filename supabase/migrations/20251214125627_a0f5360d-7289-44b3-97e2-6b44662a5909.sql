-- Create table for portfolio templates
CREATE TABLE public.portfolios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  investor_code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for custom field definitions
CREATE TABLE public.portfolio_custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'dropdown',
  options JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for portfolio custom field values
CREATE TABLE public.portfolio_field_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  field_id UUID REFERENCES public.portfolio_custom_fields(id) ON DELETE CASCADE NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_field_values ENABLE ROW LEVEL SECURITY;

-- Policies for portfolios
CREATE POLICY "Anyone can view portfolios" ON public.portfolios FOR SELECT USING (true);
CREATE POLICY "Anyone can manage portfolios" ON public.portfolios FOR ALL USING (true) WITH CHECK (true);

-- Policies for custom fields
CREATE POLICY "Anyone can view custom fields" ON public.portfolio_custom_fields FOR SELECT USING (true);
CREATE POLICY "Anyone can manage custom fields" ON public.portfolio_custom_fields FOR ALL USING (true) WITH CHECK (true);

-- Policies for field values
CREATE POLICY "Anyone can view field values" ON public.portfolio_field_values FOR SELECT USING (true);
CREATE POLICY "Anyone can manage field values" ON public.portfolio_field_values FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_portfolios_updated_at
BEFORE UPDATE ON public.portfolios
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();