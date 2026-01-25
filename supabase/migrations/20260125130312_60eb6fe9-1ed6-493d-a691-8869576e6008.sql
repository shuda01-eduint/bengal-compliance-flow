-- =============================================
-- MARGIN LOAN MANAGEMENT SYSTEM
-- =============================================

-- 1. Margin Accounts table
CREATE TABLE public.margin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  account_type TEXT DEFAULT 'margin' CHECK (account_type IN ('cash', 'margin')),
  approved_limit NUMERIC(15,2) DEFAULT 0,
  current_exposure NUMERIC(15,2) DEFAULT 0,
  margin_utilization NUMERIC(5,2) DEFAULT 0,
  maintenance_margin_required NUMERIC(15,2) DEFAULT 0,
  excess_shortfall NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  agreement_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Margin Agreements table
CREATE TABLE public.margin_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  agreement_number TEXT UNIQUE NOT NULL,
  agreement_date DATE NOT NULL,
  approved_limit NUMERIC(15,2) NOT NULL,
  interest_rate NUMERIC(5,2) DEFAULT 15.0,
  tenure_months INTEGER,
  collateral_requirements JSONB,
  terms_accepted BOOLEAN DEFAULT false,
  signed_by UUID,
  document_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'active', 'expired', 'terminated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Security Margin Categories & Haircuts
CREATE TABLE public.security_margin_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trading_code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('A', 'B', 'Z', 'N', 'G')),
  is_marginable BOOLEAN DEFAULT true,
  haircut_percentage NUMERIC(5,2) DEFAULT 30.0,
  free_float_market_cap NUMERIC(15,2),
  trailing_pe_ratio NUMERIC(8,2),
  last_eligibility_check TIMESTAMPTZ,
  eligibility_notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Margin Calls table
CREATE TABLE public.margin_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  call_date DATE NOT NULL DEFAULT CURRENT_DATE,
  margin_required NUMERIC(15,2) NOT NULL,
  current_margin NUMERIC(15,2) NOT NULL,
  shortfall_amount NUMERIC(15,2) NOT NULL,
  portfolio_value NUMERIC(15,2),
  loan_outstanding NUMERIC(15,2),
  margin_ratio NUMERIC(5,2),
  status TEXT DEFAULT 'issued' CHECK (status IN ('issued', 'acknowledged', 'resolved', 'forced_liquidation')),
  due_date DATE,
  sms_sent BOOLEAN DEFAULT false,
  email_sent BOOLEAN DEFAULT false,
  sms_sent_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Margin Collateral Holdings
CREATE TABLE public.margin_collateral (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  trading_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  average_price NUMERIC(12,2),
  current_price NUMERIC(12,2),
  market_value NUMERIC(15,2),
  haircut_percentage NUMERIC(5,2),
  collateral_value NUMERIC(15,2),
  lien_marked BOOLEAN DEFAULT true,
  as_of_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Margin Transactions (Disbursement/Repayment)
CREATE TABLE public.margin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('disbursement', 'repayment', 'interest_charge')),
  amount NUMERIC(15,2) NOT NULL,
  transaction_date DATE DEFAULT CURRENT_DATE,
  interest_rate NUMERIC(5,2),
  principal_amount NUMERIC(15,2),
  interest_amount NUMERIC(15,2),
  outstanding_balance NUMERIC(15,2),
  reference_number TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Forced Liquidations
CREATE TABLE public.forced_liquidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code TEXT NOT NULL,
  liquidation_date DATE NOT NULL,
  trading_code TEXT NOT NULL,
  quantity_sold INTEGER NOT NULL,
  sale_price NUMERIC(12,2) NOT NULL,
  total_proceeds NUMERIC(15,2) NOT NULL,
  margin_call_id UUID REFERENCES margin_calls(id),
  reason TEXT,
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Add margin fields to securities table
ALTER TABLE public.securities 
  ADD COLUMN IF NOT EXISTS margin_category TEXT CHECK (margin_category IN ('A', 'B', 'Z', 'N', 'G')),
  ADD COLUMN IF NOT EXISTS is_marginable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS haircut_percentage NUMERIC(5,2) DEFAULT 30.0,
  ADD COLUMN IF NOT EXISTS free_float_mcap NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS trailing_pe NUMERIC(8,2);

-- 9. Create indexes for performance
CREATE INDEX idx_margin_accounts_investor ON margin_accounts(investor_code);
CREATE INDEX idx_margin_accounts_status ON margin_accounts(status);
CREATE INDEX idx_margin_agreements_investor ON margin_agreements(investor_code);
CREATE INDEX idx_margin_agreements_status ON margin_agreements(status);
CREATE INDEX idx_margin_calls_investor ON margin_calls(investor_code);
CREATE INDEX idx_margin_calls_status ON margin_calls(status);
CREATE INDEX idx_margin_calls_date ON margin_calls(call_date);
CREATE INDEX idx_margin_collateral_investor ON margin_collateral(investor_code);
CREATE INDEX idx_margin_collateral_date ON margin_collateral(as_of_date);
CREATE INDEX idx_margin_transactions_investor ON margin_transactions(investor_code);
CREATE INDEX idx_margin_transactions_date ON margin_transactions(transaction_date);
CREATE INDEX idx_security_margin_cat_code ON security_margin_categories(trading_code);
CREATE INDEX idx_forced_liquidations_investor ON forced_liquidations(investor_code);
CREATE INDEX idx_securities_margin_category ON securities(margin_category);

-- 10. Enable RLS on all tables
ALTER TABLE public.margin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_margin_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_collateral ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forced_liquidations ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies for margin_accounts
CREATE POLICY "Admins can manage margin_accounts"
  ON public.margin_accounts FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view margin_accounts"
  ON public.margin_accounts FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 12. RLS Policies for margin_agreements
CREATE POLICY "Admins can manage margin_agreements"
  ON public.margin_agreements FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view margin_agreements"
  ON public.margin_agreements FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 13. RLS Policies for security_margin_categories
CREATE POLICY "Admins can manage security_margin_categories"
  ON public.security_margin_categories FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view security_margin_categories"
  ON public.security_margin_categories FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 14. RLS Policies for margin_calls
CREATE POLICY "Admins can manage margin_calls"
  ON public.margin_calls FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view margin_calls"
  ON public.margin_calls FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 15. RLS Policies for margin_collateral
CREATE POLICY "Admins can manage margin_collateral"
  ON public.margin_collateral FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view margin_collateral"
  ON public.margin_collateral FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 16. RLS Policies for margin_transactions
CREATE POLICY "Admins can manage margin_transactions"
  ON public.margin_transactions FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view margin_transactions"
  ON public.margin_transactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 17. RLS Policies for forced_liquidations
CREATE POLICY "Admins can manage forced_liquidations"
  ON public.forced_liquidations FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users can view forced_liquidations"
  ON public.forced_liquidations FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true));

-- 18. Update trigger for margin_accounts
CREATE OR REPLACE FUNCTION update_margin_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trigger_margin_accounts_updated_at
  BEFORE UPDATE ON margin_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_margin_accounts_updated_at();

-- 19. Update trigger for margin_collateral
CREATE TRIGGER trigger_margin_collateral_updated_at
  BEFORE UPDATE ON margin_collateral
  FOR EACH ROW
  EXECUTE FUNCTION update_margin_accounts_updated_at();

-- 20. Update trigger for security_margin_categories
CREATE TRIGGER trigger_security_margin_categories_updated_at
  BEFORE UPDATE ON security_margin_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_margin_accounts_updated_at();