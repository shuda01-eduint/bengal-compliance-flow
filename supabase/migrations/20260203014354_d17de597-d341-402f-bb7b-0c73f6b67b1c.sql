
-- Seed DSE Instrument Master Data (50+ stocks across various sectors)
INSERT INTO public.instrument (trading_code, full_name, isin, sector, category, market, instrument_type, face_value, lot_size, market_cap, is_marginable, haircut_pct, is_active, eps, pe_ratio, total_shares)
VALUES
-- Banks (10)
('BRACBANK', 'BRAC Bank Limited', 'BD0101BRCK0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 85000000000, true, 50, true, 3.25, 12.5, 1500000000),
('CITYBANK', 'The City Bank Limited', 'BD0101CITY0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 42000000000, true, 50, true, 2.85, 11.8, 1200000000),
('DUTCHBANGL', 'Dutch-Bangla Bank Limited', 'BD0101DBBL0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 95000000000, true, 50, true, 8.50, 9.2, 500000000),
('EBL', 'Eastern Bank Limited', 'BD0101EAST0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 38000000000, true, 50, true, 4.12, 10.5, 850000000),
('ISLAMIBANK', 'Islami Bank Bangladesh Ltd', 'BD0101IBBL0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 120000000000, true, 50, true, 3.95, 8.8, 1600000000),
('PRIMEBANK', 'Prime Bank Limited', 'BD0101PRIM0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 28000000000, true, 50, true, 2.45, 9.5, 1100000000),
('PUBALIBANK', 'Pubali Bank Limited', 'BD0101PUBL0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 32000000000, true, 50, true, 2.78, 10.2, 1050000000),
('UCBL', 'United Commercial Bank Ltd', 'BD0101UCBL0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 22000000000, true, 50, true, 1.95, 11.5, 950000000),
('BANKASIA', 'Bank Asia Limited', 'BD0101BKAS0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 25000000000, true, 50, true, 2.15, 10.8, 1150000000),
('MTBL', 'Mutual Trust Bank Limited', 'BD0101MTBL0', 'Bank', 'A', 'DSE', 'EQUITY', 10, 1, 18000000000, true, 50, true, 1.85, 12.0, 800000000),

-- Pharmaceuticals (8)
('SQURPHARMA', 'Square Pharmaceuticals Ltd', 'BD0102SQPH0', 'Pharmaceuticals', 'A', 'DSE', 'EQUITY', 10, 1, 280000000000, true, 40, true, 12.50, 18.5, 890000000),
('BEXIMCO', 'Beximco Pharmaceuticals Ltd', 'BD0102BXPH0', 'Pharmaceuticals', 'A', 'DSE', 'EQUITY', 10, 1, 85000000000, true, 45, true, 5.80, 15.2, 450000000),
('RENATA', 'Renata Limited', 'BD0102RENA0', 'Pharmaceuticals', 'A', 'DSE', 'EQUITY', 10, 1, 195000000000, true, 40, true, 45.20, 22.5, 65000000),
('GLAXOSMITH', 'GlaxoSmithKline Bangladesh', 'BD0102GLXO0', 'Pharmaceuticals', 'A', 'DSE', 'EQUITY', 10, 1, 42000000000, true, 45, true, 85.50, 28.0, 12000000),
('ACIPHARMA', 'ACI Limited', 'BD0102ACIP0', 'Pharmaceuticals', 'A', 'DSE', 'EQUITY', 10, 1, 35000000000, true, 45, true, 18.75, 14.8, 75000000),
('IBNSINA', 'Ibn Sina Pharma Ind. Ltd', 'BD0102IBNS0', 'Pharmaceuticals', 'B', 'DSE', 'EQUITY', 10, 1, 8500000000, true, 55, true, 8.25, 16.5, 45000000),
('ORIONINFU', 'Orion Infusion Limited', 'BD0102ORIN0', 'Pharmaceuticals', 'B', 'DSE', 'EQUITY', 10, 1, 6200000000, true, 55, true, 5.45, 18.2, 35000000),
('SILCOPHAR', 'Silco Pharmaceuticals Ltd', 'BD0102SILC0', 'Pharmaceuticals', 'B', 'DSE', 'EQUITY', 10, 1, 2800000000, false, 70, true, 2.85, 22.5, 28000000),

-- Engineering (6)
('BSRMSTEEL', 'BSRM Steels Limited', 'BD0103BSRM0', 'Engineering', 'A', 'DSE', 'EQUITY', 10, 1, 48000000000, true, 50, true, 6.85, 11.2, 320000000),
('GPH', 'GPH Ispat Limited', 'BD0103GPHI0', 'Engineering', 'A', 'DSE', 'EQUITY', 10, 1, 25000000000, true, 55, true, 4.25, 9.8, 180000000),
('WALTONHIL', 'Walton Hi-Tech Industries', 'BD0103WALT0', 'Engineering', 'A', 'DSE', 'EQUITY', 10, 1, 185000000000, true, 40, true, 38.50, 15.5, 125000000),
('SINGERBD', 'Singer Bangladesh Limited', 'BD0103SING0', 'Engineering', 'A', 'DSE', 'EQUITY', 10, 1, 12000000000, true, 55, true, 12.45, 14.2, 58000000),
('RANGERCEM', 'Rangpur Cement Limited', 'BD0103RANG0', 'Engineering', 'B', 'DSE', 'EQUITY', 10, 1, 5500000000, false, 65, true, 3.15, 12.8, 85000000),
('KDSALTD', 'KDSA Limited', 'BD0103KDSA0', 'Engineering', 'B', 'DSE', 'EQUITY', 10, 1, 3200000000, false, 70, true, 1.85, 15.5, 42000000),

-- Textile (6)
('SQUARETEXT', 'Square Textiles Limited', 'BD0104SQTX0', 'Textile', 'A', 'DSE', 'EQUITY', 10, 1, 18000000000, true, 55, true, 4.25, 10.5, 85000000),
('MARICO', 'Marico Bangladesh Limited', 'BD0104MRIC0', 'Textile', 'A', 'DSE', 'EQUITY', 10, 1, 62000000000, true, 45, true, 68.50, 32.5, 31500000),
('APEXFOODS', 'Apex Foods Limited', 'BD0104APEX0', 'Textile', 'B', 'DSE', 'EQUITY', 10, 1, 4500000000, false, 65, true, 8.75, 18.2, 28000000),
('DESHGARME', 'Desh Garments Limited', 'BD0104DESH0', 'Textile', 'B', 'DSE', 'EQUITY', 10, 1, 2800000000, false, 70, true, 2.45, 14.5, 45000000),
('ENVOY', 'Envoy Textiles Limited', 'BD0104ENVY0', 'Textile', 'B', 'DSE', 'EQUITY', 10, 1, 3500000000, false, 65, true, 3.85, 11.8, 52000000),
('HRTEX', 'HR Textile Limited', 'BD0104HRTX0', 'Textile', 'Z', 'DSE', 'EQUITY', 10, 1, 850000000, false, 80, true, 0.45, 28.5, 35000000),

-- Insurance (5)
('DELTALIFE', 'Delta Life Insurance Co.', 'BD0105DLIF0', 'Insurance', 'A', 'DSE', 'EQUITY', 10, 1, 18500000000, true, 55, true, 4.85, 12.5, 150000000),
('GREENDELT', 'Green Delta Ins. Co. Ltd', 'BD0105GDIC0', 'Insurance', 'A', 'DSE', 'EQUITY', 10, 1, 12000000000, true, 55, true, 3.25, 14.2, 85000000),
('PRIMEINS', 'Prime Insurance Co. Ltd', 'BD0105PRIN0', 'Insurance', 'B', 'DSE', 'EQUITY', 10, 1, 3500000000, false, 65, true, 1.85, 18.5, 42000000),
('RELIAINS', 'Reliance Insurance Ltd', 'BD0105RELI0', 'Insurance', 'B', 'DSE', 'EQUITY', 10, 1, 2800000000, false, 70, true, 1.45, 16.8, 38000000),
('PRAGATIINS', 'Pragati Insurance Ltd', 'BD0105PRAG0', 'Insurance', 'B', 'DSE', 'EQUITY', 10, 1, 4200000000, false, 65, true, 2.15, 15.2, 55000000),

-- Telecom (3)
('GP', 'Grameenphone Ltd', 'BD0106GRAM0', 'Telecom', 'A', 'DSE', 'EQUITY', 10, 1, 520000000000, true, 35, true, 18.50, 16.8, 1350000000),
('ROBI', 'Robi Axiata Limited', 'BD0106ROBI0', 'Telecom', 'A', 'DSE', 'EQUITY', 10, 1, 185000000000, true, 40, true, 2.85, 28.5, 5250000000),
('BANGLALINK', 'Banglalink Digital Comm.', 'BD0106BLNK0', 'Telecom', 'A', 'DSE', 'EQUITY', 10, 1, 95000000000, true, 45, true, 1.25, 35.2, 2800000000),

-- Power & Energy (5)
('POWERGRID', 'Power Grid Company of BD', 'BD0107PGCB0', 'Power', 'A', 'DSE', 'EQUITY', 10, 1, 125000000000, true, 45, true, 8.50, 12.5, 550000000),
('SUMITPOWER', 'Summit Power Limited', 'BD0107SUMP0', 'Power', 'A', 'DSE', 'EQUITY', 10, 1, 42000000000, true, 50, true, 3.85, 11.8, 320000000),
('TITASGAS', 'Titas Gas Trans. & Dist.', 'BD0107TITA0', 'Power', 'A', 'DSE', 'EQUITY', 10, 1, 28000000000, true, 50, true, 2.45, 14.2, 185000000),
('JAMUNAOIL', 'Jamuna Oil Company Ltd', 'BD0107JMNO0', 'Power', 'A', 'DSE', 'EQUITY', 10, 1, 35000000000, true, 50, true, 5.25, 10.5, 125000000),
('PADMAOIL', 'Padma Oil Company Ltd', 'BD0107PDMO0', 'Power', 'A', 'DSE', 'EQUITY', 10, 1, 18000000000, true, 55, true, 12.85, 9.8, 45000000),

-- Cement (4)
('HEIDELBERG', 'Heidelberg Cement BD Ltd', 'BD0108HEID0', 'Cement', 'A', 'DSE', 'EQUITY', 10, 1, 45000000000, true, 50, true, 28.50, 14.2, 56500000),
('LAFARGEHOLCIM', 'LafargeHolcim Bangladesh', 'BD0108LAFG0', 'Cement', 'A', 'DSE', 'EQUITY', 10, 1, 65000000000, true, 45, true, 18.75, 16.5, 112000000),
('PREMIERCEM', 'Premier Cement Mills Ltd', 'BD0108PREM0', 'Cement', 'A', 'DSE', 'EQUITY', 10, 1, 22000000000, true, 55, true, 5.45, 12.8, 165000000),
('MICEMENT', 'Meghna Cement Mills Ltd', 'BD0108MCML0', 'Cement', 'B', 'DSE', 'EQUITY', 10, 1, 8500000000, false, 65, true, 3.25, 15.5, 85000000),

-- Food & Allied (4)
('OLYMPIC', 'Olympic Industries Ltd', 'BD0109OLYM0', 'Food & Allied', 'A', 'DSE', 'EQUITY', 10, 1, 52000000000, true, 45, true, 32.50, 18.5, 65000000),
('BATBC', 'British American Tobacco BD', 'BD0109BATB0', 'Food & Allied', 'A', 'DSE', 'EQUITY', 10, 1, 185000000000, true, 40, true, 125.00, 15.2, 54000000),
('IFADAUTOS', 'IFAD Autos Limited', 'BD0109IFAD0', 'Food & Allied', 'A', 'DSE', 'EQUITY', 10, 1, 15000000000, true, 55, true, 8.45, 14.8, 85000000),
('FUWANGFOOD', 'Fu-Wang Foods Limited', 'BD0109FUWG0', 'Food & Allied', 'B', 'DSE', 'EQUITY', 10, 1, 4500000000, false, 65, true, 2.85, 22.5, 42000000),

-- IT Sector (4)
('BDCOM', 'BDCOM Online Limited', 'BD0110BDCM0', 'IT', 'B', 'DSE', 'EQUITY', 10, 1, 8500000000, false, 60, true, 2.45, 28.5, 125000000),
('GENEXIL', 'Genex Infosys Limited', 'BD0110GENX0', 'IT', 'B', 'DSE', 'EQUITY', 10, 1, 3200000000, false, 65, true, 1.85, 32.5, 48000000),
('ADNTEL', 'ADN Telecom Limited', 'BD0110ADNT0', 'IT', 'B', 'DSE', 'EQUITY', 10, 1, 2500000000, false, 70, true, 0.95, 45.2, 35000000),
('ABORATORIES', 'A Laboratories Limited', 'BD0110ALAB0', 'IT', 'Z', 'DSE', 'EQUITY', 10, 1, 850000000, false, 80, true, 0.25, 85.0, 22000000),

-- Ceramics (3)
('FUWANGCER', 'Fu-Wang Ceramic Ind. Ltd', 'BD0111FWCR0', 'Ceramics', 'A', 'DSE', 'EQUITY', 10, 1, 12000000000, true, 55, true, 4.85, 15.2, 95000000),
('RFRANCIS', 'R.N. Francis Ceramics', 'BD0111RNFC0', 'Ceramics', 'B', 'DSE', 'EQUITY', 10, 1, 3500000000, false, 65, true, 1.45, 18.5, 45000000),
('MONNOCER', 'Monno Ceramic Industries', 'BD0111MNCE0', 'Ceramics', 'B', 'DSE', 'EQUITY', 10, 1, 5200000000, false, 60, true, 2.85, 14.8, 68000000),

-- NBFI (2)
('IDLC', 'IDLC Finance Limited', 'BD0112IDLC0', 'NBFI', 'A', 'DSE', 'EQUITY', 10, 1, 32000000000, true, 50, true, 4.25, 12.5, 350000000),
('LANKABAFIN', 'LankaBangla Finance Ltd', 'BD0112LBFL0', 'NBFI', 'A', 'DSE', 'EQUITY', 10, 1, 18000000000, true, 55, true, 2.85, 14.2, 285000000)
ON CONFLICT (trading_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  isin = EXCLUDED.isin,
  sector = EXCLUDED.sector,
  category = EXCLUDED.category,
  market = EXCLUDED.market,
  instrument_type = EXCLUDED.instrument_type,
  face_value = EXCLUDED.face_value,
  lot_size = EXCLUDED.lot_size,
  market_cap = EXCLUDED.market_cap,
  is_marginable = EXCLUDED.is_marginable,
  haircut_pct = EXCLUDED.haircut_pct,
  is_active = EXCLUDED.is_active,
  eps = EXCLUDED.eps,
  pe_ratio = EXCLUDED.pe_ratio,
  total_shares = EXCLUDED.total_shares,
  updated_at = now();

-- Generate 30 days of price history for each instrument
-- Using a function to create realistic price movements
DO $$
DECLARE
  v_instrument RECORD;
  v_date DATE;
  v_base_price NUMERIC;
  v_prev_close NUMERIC;
  v_open NUMERIC;
  v_high NUMERIC;
  v_low NUMERIC;
  v_close NUMERIC;
  v_change NUMERIC;
  v_change_pct NUMERIC;
  v_volume INTEGER;
  v_trade_count INTEGER;
  v_value_mn NUMERIC;
  v_day INTEGER;
  v_random NUMERIC;
BEGIN
  -- Loop through each instrument
  FOR v_instrument IN SELECT trading_code, market_cap FROM public.instrument WHERE is_active = true LOOP
    -- Calculate base price from market cap (simplified)
    v_base_price := CASE 
      WHEN v_instrument.market_cap > 100000000000 THEN 250 + random() * 500
      WHEN v_instrument.market_cap > 50000000000 THEN 100 + random() * 200
      WHEN v_instrument.market_cap > 10000000000 THEN 40 + random() * 80
      ELSE 15 + random() * 35
    END;
    
    v_prev_close := v_base_price;
    
    -- Generate 30 days of data (excluding weekends)
    v_day := 0;
    v_date := CURRENT_DATE - INTERVAL '45 days';
    
    WHILE v_day < 30 LOOP
      -- Skip weekends (Friday=5, Saturday=6 in Bangladesh context - actually Fri-Sat are weekends)
      IF EXTRACT(DOW FROM v_date) NOT IN (5, 6) THEN
        -- Random daily movement between -4% and +4%
        v_random := (random() - 0.48) * 0.08; -- Slight upward bias
        v_change_pct := v_random * 100;
        v_change := v_prev_close * v_random;
        v_close := v_prev_close + v_change;
        
        -- Ensure price doesn't go below 1
        IF v_close < 1 THEN v_close := 1 + random() * 2; END IF;
        
        -- Open is close to previous close with small gap
        v_open := v_prev_close * (1 + (random() - 0.5) * 0.02);
        
        -- High and low based on volatility
        v_high := GREATEST(v_open, v_close) * (1 + random() * 0.025);
        v_low := LEAST(v_open, v_close) * (1 - random() * 0.025);
        
        -- Volume inversely related to price, with randomness
        v_volume := (50000 + random() * 500000)::INTEGER;
        v_trade_count := (100 + random() * 2000)::INTEGER;
        v_value_mn := (v_volume * v_close) / 1000000;
        
        -- Insert price record
        INSERT INTO public.instrument_prices_eod (instrument, trade_date, eod_price)
        VALUES (v_instrument.trading_code, v_date, ROUND(v_close::numeric, 2))
        ON CONFLICT (instrument, trade_date) DO UPDATE SET
          eod_price = EXCLUDED.eod_price;
        
        v_prev_close := v_close;
        v_day := v_day + 1;
      END IF;
      
      v_date := v_date + INTERVAL '1 day';
    END LOOP;
  END LOOP;
END $$;
