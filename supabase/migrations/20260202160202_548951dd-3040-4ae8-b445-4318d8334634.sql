-- =====================================================
-- Fix Security Definer Views - Set to SECURITY INVOKER
-- =====================================================

-- Recreate views with SECURITY INVOKER (default, but explicit)
DROP VIEW IF EXISTS public.vw_api_stock_daily;
CREATE VIEW public.vw_api_stock_daily 
WITH (security_invoker = on)
AS
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

DROP VIEW IF EXISTS public.vw_api_stock_historical;
CREATE VIEW public.vw_api_stock_historical 
WITH (security_invoker = on)
AS
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

DROP VIEW IF EXISTS public.vw_api_stock_fundamentals;
CREATE VIEW public.vw_api_stock_fundamentals 
WITH (security_invoker = on)
AS
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