-- Create table for CEO dashboard threshold configurations
CREATE TABLE public.ceo_dashboard_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tile_key TEXT NOT NULL UNIQUE,
  tile_name TEXT NOT NULL,
  metric_type TEXT NOT NULL DEFAULT 'value',
  warning_threshold NUMERIC,
  critical_threshold NUMERIC,
  threshold_direction TEXT NOT NULL DEFAULT 'below',
  wow_warning_threshold NUMERIC,
  wow_critical_threshold NUMERIC,
  mom_warning_threshold NUMERIC,
  mom_critical_threshold NUMERIC,
  is_enabled BOOLEAN DEFAULT true,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ceo_dashboard_thresholds ENABLE ROW LEVEL SECURITY;

-- Admins can manage thresholds
CREATE POLICY "Admins can manage thresholds"
ON public.ceo_dashboard_thresholds
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- MANCOM and department heads can view thresholds
CREATE POLICY "MANCOM can view thresholds"
ON public.ceo_dashboard_thresholds
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid()
  AND (profiles.is_mancom = true OR profiles.is_department_head = true)
  AND profiles.is_approved = true
));

-- Seed default thresholds
INSERT INTO public.ceo_dashboard_thresholds (tile_key, tile_name, metric_type, warning_threshold, critical_threshold, threshold_direction, wow_warning_threshold, wow_critical_threshold, mom_warning_threshold, mom_critical_threshold) VALUES
('active_investors', 'Active Investors', 'value', 2000, 1500, 'below', -5, -10, -10, -20),
('total_aum', 'Total AUM', 'value', 400000000, 300000000, 'below', -5, -10, -10, -20),
('margin_book', 'Margin Book', 'value', NULL, NULL, 'above', 10, 20, 15, 30),
('brokerage_commission', 'Brokerage Commission', 'percentage', 90, 75, 'below', -10, -20, -15, -25),
('negative_ledger', 'Negative Ledger Count', 'value', 10, 25, 'above', 20, 50, 30, 75),
('receivables', 'Receivables', 'value', 5000000, 10000000, 'above', 20, 40, 30, 60),
('margin_utilization', 'Margin Utilization', 'percentage', 75, 90, 'above', 10, 20, 15, 25),
('concentration_risk', 'Top 10 Client Concentration', 'percentage', 40, 60, 'above', 5, 10, 10, 20);

-- Create trigger for updated_at
CREATE TRIGGER update_ceo_dashboard_thresholds_updated_at
BEFORE UPDATE ON public.ceo_dashboard_thresholds
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();