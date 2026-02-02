-- =====================================================
-- RLS Policies for new tables (Part 2)
-- =====================================================

-- stg_deposit_withdrawal policies
CREATE POLICY "Admins manage stg_deposit_withdrawal" ON public.stg_deposit_withdrawal
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Approved users view stg_deposit_withdrawal" ON public.stg_deposit_withdrawal
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    ));

-- stg_trade_xml policies
CREATE POLICY "Admins manage stg_trade_xml" ON public.stg_trade_xml
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Approved users view stg_trade_xml" ON public.stg_trade_xml
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    ));

-- instrument policies (public read for stock data)
CREATE POLICY "Admins manage instrument" ON public.instrument
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated users view instrument" ON public.instrument
    FOR SELECT USING (true);

-- trades policies
CREATE POLICY "Admins manage trades" ON public.trades
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Approved users view trades" ON public.trades
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    ));

-- cash_ledger policies
CREATE POLICY "Admins manage cash_ledger" ON public.cash_ledger
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Approved users view cash_ledger" ON public.cash_ledger
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    ));

-- files policies
CREATE POLICY "Admins manage files" ON public.files
    FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Approved users view files" ON public.files
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_approved = true
    ));

-- =====================================================
-- API Views for Stock Data
-- =====================================================

-- 1. vw_api_stock_daily - Daily stock data with filters
CREATE OR REPLACE VIEW public.vw_api_stock_daily AS
SELECT 
    i.trading_code AS code,
    i.full_name AS name,
    i.sector,
    i.category,
    i.market,
    p.trade_date AS date,
    p.eod_price AS close_price,
    COALESCE(
        (SELECT eod_price FROM instrument_prices_eod p2 
         WHERE p2.instrument = i.trading_code 
         AND p2.trade_date < p.trade_date 
         ORDER BY p2.trade_date DESC LIMIT 1), 
        p.eod_price
    ) AS prev_close,
    p.eod_price - COALESCE(
        (SELECT eod_price FROM instrument_prices_eod p2 
         WHERE p2.instrument = i.trading_code 
         AND p2.trade_date < p.trade_date 
         ORDER BY p2.trade_date DESC LIMIT 1), 
        p.eod_price
    ) AS change,
    CASE 
        WHEN COALESCE(
            (SELECT eod_price FROM instrument_prices_eod p2 
             WHERE p2.instrument = i.trading_code 
             AND p2.trade_date < p.trade_date 
             ORDER BY p2.trade_date DESC LIMIT 1), 
            p.eod_price
        ) > 0 
        THEN ROUND(
            ((p.eod_price - COALESCE(
                (SELECT eod_price FROM instrument_prices_eod p2 
                 WHERE p2.instrument = i.trading_code 
                 AND p2.trade_date < p.trade_date 
                 ORDER BY p2.trade_date DESC LIMIT 1), 
                p.eod_price
            )) / COALESCE(
                (SELECT eod_price FROM instrument_prices_eod p2 
                 WHERE p2.instrument = i.trading_code 
                 AND p2.trade_date < p.trade_date 
                 ORDER BY p2.trade_date DESC LIMIT 1), 
                p.eod_price
            )) * 100, 2
        )
        ELSE 0 
    END AS change_pct,
    i.market_cap,
    i.pe_ratio,
    i.eps,
    i.is_marginable,
    i.haircut_pct
FROM public.instrument i
LEFT JOIN public.instrument_prices_eod p ON i.trading_code = p.instrument
WHERE i.is_active = true;

-- 2. vw_api_stock_historical - Historical stock data with pagination support
CREATE OR REPLACE VIEW public.vw_api_stock_historical AS
SELECT 
    i.trading_code AS code,
    i.full_name AS name,
    p.trade_date AS date,
    p.eod_price AS close_price,
    COALESCE(
        (SELECT eod_price FROM instrument_prices_eod p2 
         WHERE p2.instrument = i.trading_code 
         AND p2.trade_date < p.trade_date 
         ORDER BY p2.trade_date DESC LIMIT 1), 
        p.eod_price
    ) AS open_price,
    p.eod_price AS high_price,
    p.eod_price AS low_price,
    0 AS volume,
    0 AS trade_count,
    0 AS value_mn
FROM public.instrument i
INNER JOIN public.instrument_prices_eod p ON i.trading_code = p.instrument;

-- 3. vw_api_stock_fundamentals - Stock fundamentals
CREATE OR REPLACE VIEW public.vw_api_stock_fundamentals AS
SELECT 
    i.trading_code AS code,
    i.full_name AS name,
    i.isin,
    i.sector,
    i.category,
    i.market,
    i.instrument_type,
    i.face_value,
    i.lot_size,
    i.market_cap,
    i.free_float_mcap,
    i.eps,
    i.pe_ratio,
    i.nav,
    i.week_52_high,
    i.week_52_low,
    i.listing_year,
    i.last_agm_date,
    i.authorized_cap,
    i.paid_up_cap,
    i.total_shares,
    i.is_marginable,
    i.haircut_pct,
    i.is_active,
    i.last_synced_at,
    i.updated_at
FROM public.instrument i;

-- Grant access to views
GRANT SELECT ON public.vw_api_stock_daily TO authenticated;
GRANT SELECT ON public.vw_api_stock_historical TO authenticated;
GRANT SELECT ON public.vw_api_stock_fundamentals TO authenticated;

-- =====================================================
-- Helper RPC functions for API filtering/pagination
-- =====================================================

-- 1. get_stock_daily - Filter daily stocks
CREATE OR REPLACE FUNCTION public.get_stock_daily(
    _date date DEFAULT NULL,
    _sector text DEFAULT NULL,
    _code text DEFAULT NULL,
    _limit integer DEFAULT 100,
    _offset integer DEFAULT 0
)
RETURNS TABLE (
    code text,
    name text,
    sector text,
    category text,
    market text,
    date date,
    close_price numeric,
    prev_close numeric,
    change numeric,
    change_pct numeric,
    market_cap numeric,
    pe_ratio numeric,
    eps numeric,
    is_marginable boolean,
    haircut_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        v.code,
        v.name,
        v.sector,
        v.category,
        v.market,
        v.date,
        v.close_price,
        v.prev_close,
        v.change,
        v.change_pct,
        v.market_cap,
        v.pe_ratio,
        v.eps,
        v.is_marginable,
        v.haircut_pct
    FROM vw_api_stock_daily v
    WHERE (_date IS NULL OR v.date = _date)
      AND (_sector IS NULL OR v.sector = _sector)
      AND (_code IS NULL OR v.code = _code)
    ORDER BY v.code
    LIMIT _limit
    OFFSET _offset;
$$;

-- 2. get_stock_historical - Historical data with pagination
CREATE OR REPLACE FUNCTION public.get_stock_historical(
    _code text,
    _from_date date DEFAULT NULL,
    _to_date date DEFAULT NULL,
    _limit integer DEFAULT 100,
    _offset integer DEFAULT 0
)
RETURNS TABLE (
    code text,
    name text,
    date date,
    close_price numeric,
    open_price numeric,
    high_price numeric,
    low_price numeric,
    volume bigint,
    trade_count integer,
    value_mn numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        v.code,
        v.name,
        v.date,
        v.close_price,
        v.open_price,
        v.high_price,
        v.low_price,
        v.volume::bigint,
        v.trade_count::integer,
        v.value_mn
    FROM vw_api_stock_historical v
    WHERE v.code = _code
      AND (_from_date IS NULL OR v.date >= _from_date)
      AND (_to_date IS NULL OR v.date <= _to_date)
    ORDER BY v.date DESC
    LIMIT _limit
    OFFSET _offset;
$$;

-- 3. get_stock_fundamentals - Get fundamentals for a stock
CREATE OR REPLACE FUNCTION public.get_stock_fundamentals(
    _code text
)
RETURNS TABLE (
    code text,
    name text,
    isin text,
    sector text,
    category text,
    market text,
    instrument_type text,
    face_value numeric,
    lot_size integer,
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
    is_marginable boolean,
    haircut_pct numeric,
    is_active boolean,
    last_synced_at timestamptz,
    updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        v.code,
        v.name,
        v.isin,
        v.sector,
        v.category,
        v.market,
        v.instrument_type,
        v.face_value,
        v.lot_size::integer,
        v.market_cap,
        v.free_float_mcap,
        v.eps,
        v.pe_ratio,
        v.nav,
        v.week_52_high,
        v.week_52_low,
        v.listing_year,
        v.last_agm_date,
        v.authorized_cap,
        v.paid_up_cap,
        v.total_shares,
        v.is_marginable,
        v.haircut_pct,
        v.is_active,
        v.last_synced_at,
        v.updated_at
    FROM vw_api_stock_fundamentals v
    WHERE v.code = _code;
$$;