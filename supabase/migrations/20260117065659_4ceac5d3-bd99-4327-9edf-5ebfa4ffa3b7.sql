-- ============================================
-- COMMISSION RATE SCHEME TABLE
-- ============================================
CREATE TABLE commission_rate_scheme (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code       text NOT NULL,
  description       text,
  investor_group    text,
  rm_id             uuid,
  instrument_group  text,
  min_trade_value   numeric(18,2) DEFAULT 0,
  max_trade_value   numeric(18,2),
  commission_type   text NOT NULL,
  commission_rate   numeric(18,8) NOT NULL,
  min_commission    numeric(18,2) DEFAULT 0,
  max_commission    numeric(18,2),
  effective_from    date NOT NULL,
  effective_to      date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);

CREATE INDEX idx_commission_rate_effective 
ON commission_rate_scheme(effective_from, effective_to, is_active);

ALTER TABLE commission_rate_scheme ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage commission_rate_scheme" ON commission_rate_scheme
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view commission_rate_scheme" ON commission_rate_scheme
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true
  ));

-- ============================================
-- RELATIONSHIP MANAGER TABLE
-- ============================================
CREATE TABLE relationship_manager (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rm_code         text UNIQUE NOT NULL,
  rm_name         text NOT NULL,
  rm_email        text,
  branch_code     text,
  department      text,
  status          text NOT NULL DEFAULT 'ACTIVE',
  hire_date       date,
  resign_date     date,
  default_commission_scheme_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rm_code ON relationship_manager(rm_code);
CREATE INDEX idx_rm_email ON relationship_manager(rm_email);

ALTER TABLE relationship_manager ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage relationship_manager" ON relationship_manager
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view relationship_manager" ON relationship_manager
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true
  ));

-- ============================================
-- INVESTOR-RM MAPPING WITH EFFECTIVE DATES
-- ============================================
CREATE TABLE investor_rm_mapping_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_code   text NOT NULL,
  rm_id           uuid NOT NULL REFERENCES relationship_manager(id),
  effective_from  date NOT NULL,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_investor_rm_no_overlap
ON investor_rm_mapping_v2(investor_code, effective_from);

ALTER TABLE investor_rm_mapping_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage investor_rm_mapping_v2" ON investor_rm_mapping_v2
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view investor_rm_mapping_v2" ON investor_rm_mapping_v2
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true
  ));

-- ============================================
-- CHARGE/FEE RATE SCHEME TABLE
-- ============================================
CREATE TABLE charge_rate_scheme (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_code       text NOT NULL,
  description       text,
  charge_type       text NOT NULL,
  basis             text,
  investor_group    text,
  min_base_amount   numeric(18,2),
  max_base_amount   numeric(18,2),
  rate              numeric(18,8) NOT NULL,
  min_charge        numeric(18,2) DEFAULT 0,
  max_charge        numeric(18,2),
  effective_from    date NOT NULL,
  effective_to      date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);

CREATE INDEX idx_charge_rate_effective 
ON charge_rate_scheme(charge_code, effective_from, effective_to, is_active);

ALTER TABLE charge_rate_scheme ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage charge_rate_scheme" ON charge_rate_scheme
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users can view charge_rate_scheme" ON charge_rate_scheme
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true
  ));

-- ============================================
-- FUNCTION: GET COMMISSION RATE FOR TRADE
-- ============================================
CREATE OR REPLACE FUNCTION get_commission_rate(
  p_trade_date date,
  p_investor_group text DEFAULT NULL,
  p_rm_id uuid DEFAULT NULL,
  p_instrument_group text DEFAULT NULL,
  p_trade_value numeric DEFAULT 0
)
RETURNS TABLE(
  scheme_code text,
  commission_type text,
  commission_rate numeric,
  min_commission numeric,
  max_commission numeric
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    crs.scheme_code,
    crs.commission_type,
    crs.commission_rate,
    crs.min_commission,
    crs.max_commission
  FROM commission_rate_scheme crs
  WHERE crs.is_active = true
    AND crs.effective_from <= p_trade_date
    AND (crs.effective_to IS NULL OR crs.effective_to >= p_trade_date)
    AND (crs.investor_group IS NULL OR crs.investor_group = p_investor_group)
    AND (crs.rm_id IS NULL OR crs.rm_id = p_rm_id)
    AND (crs.instrument_group IS NULL OR crs.instrument_group = p_instrument_group)
    AND (crs.min_trade_value <= p_trade_value)
    AND (crs.max_trade_value IS NULL OR crs.max_trade_value >= p_trade_value)
  ORDER BY 
    (CASE WHEN crs.rm_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN crs.investor_group IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN crs.instrument_group IS NOT NULL THEN 1 ELSE 0 END) DESC,
    crs.effective_from DESC
  LIMIT 1;
$$;

-- ============================================
-- FUNCTION: GET RM FOR INVESTOR AT DATE
-- ============================================
CREATE OR REPLACE FUNCTION get_investor_rm(
  p_investor_code text,
  p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  rm_id uuid,
  rm_code text,
  rm_name text,
  rm_email text,
  department text,
  default_commission_scheme_code text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    rm.id,
    rm.rm_code,
    rm.rm_name,
    rm.rm_email,
    rm.department,
    rm.default_commission_scheme_code
  FROM investor_rm_mapping_v2 irm
  JOIN relationship_manager rm ON rm.id = irm.rm_id
  WHERE irm.investor_code = p_investor_code
    AND irm.effective_from <= p_as_of_date
    AND (irm.effective_to IS NULL OR irm.effective_to >= p_as_of_date)
    AND rm.status = 'ACTIVE'
  ORDER BY irm.effective_from DESC
  LIMIT 1;
$$;

-- ============================================
-- FUNCTION: GET CHARGE RATE
-- ============================================
CREATE OR REPLACE FUNCTION get_charge_rate(
  p_charge_code text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_investor_group text DEFAULT NULL,
  p_base_amount numeric DEFAULT 0
)
RETURNS TABLE(
  charge_code text,
  charge_type text,
  rate numeric,
  min_charge numeric,
  max_charge numeric,
  basis text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    crs.charge_code,
    crs.charge_type,
    crs.rate,
    crs.min_charge,
    crs.max_charge,
    crs.basis
  FROM charge_rate_scheme crs
  WHERE crs.charge_code = p_charge_code
    AND crs.is_active = true
    AND crs.effective_from <= p_as_of_date
    AND (crs.effective_to IS NULL OR crs.effective_to >= p_as_of_date)
    AND (crs.investor_group IS NULL OR crs.investor_group = p_investor_group)
    AND (crs.min_base_amount IS NULL OR crs.min_base_amount <= p_base_amount)
    AND (crs.max_base_amount IS NULL OR crs.max_base_amount >= p_base_amount)
  ORDER BY crs.effective_from DESC
  LIMIT 1;
$$;