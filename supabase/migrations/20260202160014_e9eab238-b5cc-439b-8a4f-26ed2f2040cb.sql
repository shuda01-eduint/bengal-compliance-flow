-- =====================================================
-- Create missing tables (Part 1)
-- =====================================================

-- 1. stg_deposit_withdrawal - Staging table for deposit/withdrawal imports
CREATE TABLE IF NOT EXISTS public.stg_deposit_withdrawal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_code text NOT NULL,
    txn_date date NOT NULL,
    txn_type text NOT NULL,
    amount numeric NOT NULL,
    description text,
    reference text,
    bank_name text,
    cheque_no text,
    status text DEFAULT 'PENDING',
    processed_at timestamptz,
    file_id uuid,
    created_at timestamptz DEFAULT now()
);

-- 2. stg_trade_xml - Staging table for XML trade imports
CREATE TABLE IF NOT EXISTS public.stg_trade_xml (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_xml text,
    parsed_data jsonb,
    trade_date date,
    exchange_code text,
    file_name text,
    status text DEFAULT 'PENDING',
    error_message text,
    processed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- 3. instrument - Master table for securities/instruments
CREATE TABLE IF NOT EXISTS public.instrument (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trading_code text UNIQUE NOT NULL,
    full_name text,
    isin text,
    sector text,
    category text,
    market text DEFAULT 'DSE',
    instrument_type text DEFAULT 'EQUITY',
    face_value numeric DEFAULT 10,
    lot_size integer DEFAULT 1,
    is_active boolean DEFAULT true,
    is_marginable boolean DEFAULT false,
    haircut_pct numeric DEFAULT 100,
    market_cap numeric,
    free_float_mcap numeric,
    eps numeric,
    pe_ratio numeric,
    nav numeric,
    week_52_high numeric,
    week_52_low numeric,
    listing_year integer,
    last_agm_date date,
    authorized_cap numeric,
    paid_up_cap numeric,
    total_shares bigint,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 4. trades - Actual settled trade records
CREATE TABLE IF NOT EXISTS public.trades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_date date NOT NULL,
    settlement_date date,
    investor_code text NOT NULL,
    instrument text NOT NULL,
    side text NOT NULL,
    quantity integer NOT NULL,
    price numeric NOT NULL,
    trade_value numeric NOT NULL,
    commission numeric DEFAULT 0,
    other_charges numeric DEFAULT 0,
    net_value numeric NOT NULL,
    exchange_code text,
    order_id text,
    trade_id text,
    status text DEFAULT 'SETTLED',
    created_at timestamptz DEFAULT now()
);

-- 5. cash_ledger - Cash ledger entries
CREATE TABLE IF NOT EXISTS public.cash_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_code text NOT NULL,
    txn_date date NOT NULL,
    value_date date,
    txn_type text NOT NULL,
    debit numeric DEFAULT 0,
    credit numeric DEFAULT 0,
    balance numeric,
    description text,
    reference text,
    source_table text,
    source_id uuid,
    created_at timestamptz DEFAULT now()
);

-- 6. files - File tracking for imports
CREATE TABLE IF NOT EXISTS public.files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name text NOT NULL,
    file_type text,
    file_size bigint,
    mime_type text,
    storage_path text,
    upload_date date DEFAULT CURRENT_DATE,
    uploaded_by uuid,
    uploaded_by_email text,
    status text DEFAULT 'UPLOADED',
    records_count integer,
    success_count integer,
    error_count integer,
    error_details jsonb,
    processed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- =====================================================
-- Create indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_stg_deposit_investor ON public.stg_deposit_withdrawal(investor_code);
CREATE INDEX IF NOT EXISTS idx_stg_deposit_date ON public.stg_deposit_withdrawal(txn_date);

CREATE INDEX IF NOT EXISTS idx_instrument_code ON public.instrument(trading_code);
CREATE INDEX IF NOT EXISTS idx_instrument_sector ON public.instrument(sector);
CREATE INDEX IF NOT EXISTS idx_instrument_category ON public.instrument(category);

CREATE INDEX IF NOT EXISTS idx_trades_date ON public.trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_investor ON public.trades(investor_code);
CREATE INDEX IF NOT EXISTS idx_trades_instrument ON public.trades(instrument);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_investor ON public.cash_ledger(investor_code);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_date ON public.cash_ledger(txn_date);

CREATE INDEX IF NOT EXISTS idx_files_type ON public.files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_status ON public.files(status);

-- =====================================================
-- Enable RLS on all new tables
-- =====================================================

ALTER TABLE public.stg_deposit_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stg_trade_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;