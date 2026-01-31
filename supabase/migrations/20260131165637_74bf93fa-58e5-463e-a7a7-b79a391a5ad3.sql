-- Trade staging table (new EOD processing table)
CREATE TABLE public.trade_file (
  trade_id bigserial PRIMARY KEY,
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  instrument text NOT NULL,
  side text CHECK (side IN ('BUY','SELL')),
  qty numeric(18,4) NOT NULL,
  price numeric(18,6) NOT NULL,
  settlement_date date NOT NULL,
  commission numeric(18,6) DEFAULT 0,
  category text,
  fill_type text,
  exchange_code text,
  created_at timestamptz DEFAULT now()
);

-- Cash ledger transactions (deposits/withdrawals with types)
CREATE TABLE public.cash_ledger_txn (
  txn_id bigserial PRIMARY KEY,
  txn_date date NOT NULL,
  investor_code text NOT NULL,
  type text CHECK (type IN ('DEPOSIT','WITHDRAW','TRADE_CASH','COMMISSION','INTEREST','OTHER')),
  amount numeric(18,2) NOT NULL,
  description text,
  reference text,
  created_at timestamptz DEFAULT now()
);

-- Cheque tracking
CREATE TABLE public.cheque_in_hand (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  amount numeric(18,2) NOT NULL,
  cheque_date date NOT NULL,
  status text CHECK (status IN ('PENDING','CLEARED','BOUNCED')) DEFAULT 'PENDING',
  created_at timestamptz DEFAULT now()
);

-- Daily instrument prices
CREATE TABLE public.instrument_prices_eod (
  trade_date date NOT NULL,
  instrument text NOT NULL,
  eod_price numeric(18,6) NOT NULL,
  PRIMARY KEY (trade_date, instrument)
);

-- EOD instrument positions
CREATE TABLE public.eod_instrument_position (
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  instrument text NOT NULL,
  total_stock numeric(18,4) NOT NULL,
  saleable numeric(18,4) NOT NULL,
  avg_cost numeric(18,6) NOT NULL,
  total_cost numeric(18,2) NOT NULL,
  total_market_value numeric(18,2) NOT NULL,
  PRIMARY KEY (trade_date, investor_code, instrument)
);

-- EOD investor balance summary (new - replaces eod_ledger_snapshots for new flow)
CREATE TABLE public.eod_investor_balance (
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  boid text,
  rm_id text,
  opening_ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  matured_balance numeric(18,2) NOT NULL DEFAULT 0,
  receivable_sales numeric(18,2) NOT NULL DEFAULT 0,
  cheque_in_tran_hand numeric(18,2) NOT NULL DEFAULT 0,
  accrued_int numeric(18,2) NOT NULL DEFAULT 0,
  closing_ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  equity numeric(18,2) NOT NULL DEFAULT 0,
  d_e_rate numeric(18,6),
  PRIMARY KEY (trade_date, investor_code)
);

-- Investor charge configuration (commission/interest rates with effective dates)
CREATE TABLE public.investor_charge_config (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  commission_rate numeric(10,4) NOT NULL,
  charge_rate numeric(10,4) NOT NULL,
  d_e_limit numeric(18,6),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz DEFAULT now()
);

-- Investor change audit log
CREATE TABLE public.investor_change_logs (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by text NOT NULL,
  changed_at timestamptz DEFAULT now(),
  approval_status text DEFAULT 'PENDING',
  approved_by text,
  approved_at timestamptz
);

-- Create indexes for performance
CREATE INDEX idx_trade_file_date ON public.trade_file(trade_date);
CREATE INDEX idx_trade_file_investor ON public.trade_file(investor_code);
CREATE INDEX idx_trade_file_instrument ON public.trade_file(instrument);
CREATE INDEX idx_cash_ledger_date ON public.cash_ledger_txn(txn_date);
CREATE INDEX idx_cash_ledger_investor ON public.cash_ledger_txn(investor_code);
CREATE INDEX idx_eod_investor_balance_date ON public.eod_investor_balance(trade_date);
CREATE INDEX idx_eod_instrument_position_date ON public.eod_instrument_position(trade_date);
CREATE INDEX idx_eod_instrument_position_investor ON public.eod_instrument_position(investor_code);
CREATE INDEX idx_investor_charge_config_investor ON public.investor_charge_config(investor_code);
CREATE INDEX idx_investor_change_logs_investor ON public.investor_change_logs(investor_code);
CREATE INDEX idx_cheque_in_hand_investor ON public.cheque_in_hand(investor_code);
CREATE INDEX idx_instrument_prices_eod_instrument ON public.instrument_prices_eod(instrument);

-- Enable RLS on all new tables
ALTER TABLE public.trade_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_ledger_txn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_in_hand ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_prices_eod ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_instrument_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_investor_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_charge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_change_logs ENABLE ROW LEVEL SECURITY;

-- Admin policies (full access for admins)
CREATE POLICY "Admins manage trade_file" ON public.trade_file FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage cash_ledger_txn" ON public.cash_ledger_txn FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage cheque_in_hand" ON public.cheque_in_hand FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage instrument_prices_eod" ON public.instrument_prices_eod FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage eod_instrument_position" ON public.eod_instrument_position FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage eod_investor_balance" ON public.eod_investor_balance FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage investor_charge_config" ON public.investor_charge_config FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage investor_change_logs" ON public.investor_change_logs FOR ALL USING (has_role(auth.uid(), 'admin'));

-- View policies for approved users
CREATE POLICY "Approved users view trade_file" ON public.trade_file FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view cash_ledger_txn" ON public.cash_ledger_txn FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view cheque_in_hand" ON public.cheque_in_hand FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view instrument_prices_eod" ON public.instrument_prices_eod FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view eod_instrument_position" ON public.eod_instrument_position FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view eod_investor_balance" ON public.eod_investor_balance FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view investor_charge_config" ON public.investor_charge_config FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
CREATE POLICY "Approved users view investor_change_logs" ON public.investor_change_logs FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));