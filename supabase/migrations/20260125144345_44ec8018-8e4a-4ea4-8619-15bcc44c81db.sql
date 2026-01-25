-- Step 1: Create eod_holding_snapshots table (required for the view)
CREATE TABLE IF NOT EXISTS public.eod_holding_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  eod_date DATE NOT NULL,
  security_code TEXT NOT NULL,
  total_qty_saleable INTEGER DEFAULT 0,
  total_qty INTEGER DEFAULT 0,
  avg_cost NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  market_value NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(investor_code, eod_date, security_code)
);

-- Enable RLS
ALTER TABLE public.eod_holding_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage eod_holding_snapshots" 
ON public.eod_holding_snapshots 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view eod_holding_snapshots" 
ON public.eod_holding_snapshots 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.id = auth.uid() AND profiles.is_approved = true
));

-- Add indexes for performance
CREATE INDEX idx_eod_holding_snapshots_investor_date 
ON public.eod_holding_snapshots(investor_code, eod_date);

CREATE INDEX idx_eod_holding_snapshots_security_date 
ON public.eod_holding_snapshots(security_code, eod_date);

-- Step 2: Create the margin_equity_snapshots view with corrected column names
CREATE OR REPLACE VIEW margin_equity_snapshots AS
WITH prev_ledger AS (
  SELECT investor_code, eod_date, closing_balance AS prev_closing_balance
  FROM eod_ledger_snapshots
),
holdings_enriched AS (
  SELECT
    h.investor_code, 
    h.eod_date, 
    h.security_code,
    h.total_qty_saleable AS quantity,
    s.close_price AS market_price,
    h.total_qty_saleable * s.close_price AS market_value,
    COALESCE(smc.is_marginable, FALSE) AS is_marginable,
    COALESCE(smc.haircut_percentage, 0) AS haircut_percent
  FROM eod_holding_snapshots h
  JOIN securities s ON s.trading_code = h.security_code
  LEFT JOIN security_margin_categories smc ON smc.trading_code = h.security_code
),
holdings_agg AS (
  SELECT 
    investor_code, 
    eod_date,
    SUM(CASE WHEN is_marginable THEN market_value * (1 - haircut_percent / 100.0) ELSE 0 END) AS marginable_after_haircut,
    SUM(CASE WHEN NOT is_marginable THEN market_value ELSE 0 END) AS non_marginable_value
  FROM holdings_enriched 
  GROUP BY investor_code, eod_date
)
SELECT
  l.investor_code, 
  l.eod_date,
  i.rm_name, 
  i.department AS department_name,
  l.closing_balance AS ledger_closing_balance,
  COALESCE(h.marginable_after_haircut, 0) AS marginable_after_haircut,
  COALESCE(h.non_marginable_value, 0) AS non_marginable_holdings,
  COALESCE(p.prev_closing_balance, 0) AS previous_day_balance,
  COALESCE(i.interest_rate, 0) AS margin_interest_rate,
  COALESCE(i.interest_rate, 0) * COALESCE(p.prev_closing_balance, 0) / 365.0 AS accrued_interest,
  l.closing_balance + COALESCE(h.marginable_after_haircut, 0) + COALESCE(h.non_marginable_value, 0) + COALESCE(COALESCE(i.interest_rate, 0) * COALESCE(p.prev_closing_balance, 0) / 365.0, 0) AS equity
FROM eod_ledger_snapshots l
LEFT JOIN holdings_agg h ON h.investor_code = l.investor_code AND h.eod_date = l.eod_date
LEFT JOIN prev_ledger p ON p.investor_code = l.investor_code AND p.eod_date = l.eod_date - INTERVAL '1 day'
LEFT JOIN investors i ON i.investor_code = l.investor_code;