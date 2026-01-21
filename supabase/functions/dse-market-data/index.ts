import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// External Stock Data API Configuration
const EXTERNAL_STOCK_URL = 'https://osglgpafsqthqolqbnwu.supabase.co/functions/v1/stock-data';
const EXTERNAL_API_KEY = Deno.env.get('EXTERNAL_STOCK_API_KEY') || '';

// Supabase client for storing data
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DSEPriceData {
  trading_code: string;
  close_price: number;
  high_price?: number;
  low_price?: number;
  open_price?: number;
  volume?: number;
  value?: number;
  trade_count?: number;
  last_trade_price?: number;
  change?: number;
  change_percent?: number;
}

interface DSEFundamentalData {
  trading_code: string;
  eps?: number;
  audited_pe?: number;
  sector?: string;
  category?: string;
  market_cap?: number;
  total_securities?: number;
  director_percent?: number;
  govt_percent?: number;
  institute_percent?: number;
  foreign_percent?: number;
  public_percent?: number;
}

// Check if External API is configured
function isExternalAPIConfigured(): boolean {
  return !!EXTERNAL_API_KEY;
}

// Get connection info (masked for security)
function getConnectionInfo(): { configured: boolean; endpoint: string } {
  return {
    configured: isExternalAPIConfigured(),
    endpoint: EXTERNAL_STOCK_URL,
  };
}

// Fetch data from external stock-data API
async function fetchFromExternalAPI(params?: Record<string, unknown>): Promise<unknown> {
  if (!isExternalAPIConfigured()) {
    throw new Error('External Stock API key not configured. Please add EXTERNAL_STOCK_API_KEY secret.');
  }

  console.log(`Fetching data from external API: ${EXTERNAL_STOCK_URL}`);
  console.log(`Request params:`, JSON.stringify(params || {}));

  const response = await fetch(EXTERNAL_STOCK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': EXTERNAL_API_KEY,
    },
    body: JSON.stringify(params || {}),
  });

  console.log(`External API response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`External API error: ${response.status} - ${errorText}`);
    throw new Error(`External API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`External API full response:`, JSON.stringify(data));
  return data;
}

// Map external API response to DSEPriceData format
// Handles the external API structure: { success: true, data: { symbol, market: {...}, fundamentals: {...} } }
function mapToDSEPriceData(data: unknown): DSEPriceData[] {
  if (!data || typeof data !== 'object') return [];
  
  const obj = data as Record<string, unknown>;
  
  // Handle external API single-stock response: { success: true, data: { symbol, market: {...} } }
  if (obj.success && obj.data && typeof obj.data === 'object') {
    const stockData = obj.data as Record<string, unknown>;
    const market = (stockData.market || {}) as Record<string, unknown>;
    
    const tradingCode = String(stockData.symbol || '');
    if (!tradingCode) {
      console.log('No trading code found in response');
      return [];
    }
    
    // Parse numeric values
    const ltp = parseFloat(String(market.ltp || 0)) || 0;
    const closeFromAPI = parseFloat(String(market.close || market.previousClose || 0)) || 0;
    
    // Use LTP when close_price is 0, else use close_price
    const finalClosePrice = closeFromAPI === 0 ? ltp : closeFromAPI;
    
    const highPrice = parseFloat(String(market.high || 0)) || 0;
    const lowPrice = parseFloat(String(market.low || 0)) || 0;
    const openPrice = parseFloat(String(market.open || 0)) || 0;
    const volume = parseInt(String(market.volume || 0)) || 0;
    const valueMn = parseFloat(String(market.valueMn || 0)) || 0;
    const value = valueMn * 1000000; // Convert from millions
    const tradeCount = parseInt(String(market.trade || 0)) || 0;
    const change = parseFloat(String(market.change || 0)) || 0;
    const changePercent = parseFloat(String(market.changePercent || 0)) || 0;
    
    console.log(`Mapped ${tradingCode}: LTP=${ltp}, closeFromAPI=${closeFromAPI}, finalClosePrice=${finalClosePrice}`);
    
    return [{
      trading_code: tradingCode,
      close_price: finalClosePrice,
      last_trade_price: ltp,
      high_price: highPrice || undefined,
      low_price: lowPrice || undefined,
      open_price: openPrice || undefined,
      volume: volume || undefined,
      value: value || undefined,
      trade_count: tradeCount || undefined,
      change: change || undefined,
      change_percent: changePercent || undefined,
    }];
  }
  
  // Fallback: Handle array response formats
  let items: unknown[] = [];
  
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(obj.data)) {
    items = obj.data;
  } else if (Array.isArray(obj.prices)) {
    items = obj.prices;
  } else if (Array.isArray(obj.stocks)) {
    items = obj.stocks;
  } else if (Array.isArray(obj.results)) {
    items = obj.results;
  } else {
    console.log('Unexpected response structure:', JSON.stringify(data).substring(0, 200));
    return [];
  }

  return items.map((item: unknown) => {
    const row = item as Record<string, unknown>;
    const ltp = parseFloat(String(row.ltp || row.lastPrice || 0)) || 0;
    const closeFromRow = parseFloat(String(row.close_price || row.closePrice || row.close || 0)) || 0;
    const finalClosePrice = closeFromRow === 0 ? ltp : closeFromRow;
    
    return {
      trading_code: String(row.trading_code || row.tradingCode || row.symbol || row.code || ''),
      close_price: finalClosePrice,
      last_trade_price: ltp || undefined,
      high_price: parseFloat(String(row.high_price || row.highPrice || row.high || 0)) || undefined,
      low_price: parseFloat(String(row.low_price || row.lowPrice || row.low || 0)) || undefined,
      open_price: parseFloat(String(row.open_price || row.openPrice || row.open || 0)) || undefined,
      volume: parseInt(String(row.volume || row.qty || row.quantity || 0)) || undefined,
      value: parseFloat(String(row.value || row.turnover || 0)) || undefined,
      trade_count: parseInt(String(row.trade_count || row.tradeCount || row.trades || 0)) || undefined,
      change: parseFloat(String(row.change || row.priceChange || 0)) || undefined,
      change_percent: parseFloat(String(row.change_percent || row.changePercent || row.pchange || 0)) || undefined,
    };
  }).filter(item => item.trading_code);
}

// Map external API response to DSEFundamentalData format
function mapToDSEFundamentalData(data: unknown): DSEFundamentalData[] {
  if (!data || typeof data !== 'object') return [];
  
  const obj = data as Record<string, unknown>;
  
  // Handle external API single-stock response: { success: true, data: { symbol, fundamentals: {...} } }
  if (obj.success && obj.data && typeof obj.data === 'object') {
    const stockData = obj.data as Record<string, unknown>;
    const fundamentals = (stockData.fundamentals || {}) as Record<string, unknown>;
    
    const tradingCode = String(stockData.symbol || '');
    if (!tradingCode) return [];
    
    return [{
      trading_code: tradingCode,
      sector: String(stockData.sector || '') || undefined,
      category: String(stockData.category || '') || undefined,
      eps: parseFloat(String(fundamentals.eps || 0)) || undefined,
      audited_pe: parseFloat(String(fundamentals.pe || 0)) || undefined,
      market_cap: parseFloat(String(fundamentals.marketCap || 0)) || undefined,
      total_securities: parseInt(String(fundamentals.totalShares || 0)) || undefined,
    }];
  }
  
  // Fallback: Handle array response formats
  let items: unknown[] = [];
  
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(obj.data)) {
    items = obj.data;
  } else if (Array.isArray(obj.fundamentals)) {
    items = obj.fundamentals;
  }

  return items.map((item: unknown) => {
    const row = item as Record<string, unknown>;
    return {
      trading_code: String(row.trading_code || row.tradingCode || row.symbol || ''),
      eps: parseFloat(String(row.eps || 0)) || undefined,
      audited_pe: parseFloat(String(row.audited_pe || row.pe || row.peRatio || 0)) || undefined,
      sector: String(row.sector || '') || undefined,
      category: String(row.category || '') || undefined,
      market_cap: parseFloat(String(row.market_cap || row.marketCap || 0)) || undefined,
      total_securities: parseInt(String(row.total_securities || row.totalSecurities || row.shares || 0)) || undefined,
      director_percent: parseFloat(String(row.director_percent || row.directorPercent || 0)) || undefined,
      govt_percent: parseFloat(String(row.govt_percent || row.govtPercent || 0)) || undefined,
      institute_percent: parseFloat(String(row.institute_percent || row.institutePercent || 0)) || undefined,
      foreign_percent: parseFloat(String(row.foreign_percent || row.foreignPercent || 0)) || undefined,
      public_percent: parseFloat(String(row.public_percent || row.publicPercent || 0)) || undefined,
    };
  }).filter(item => item.trading_code);
}

// Fetch real-time/latest market prices from external API
async function fetchRealTimePrices(tradingCodes?: string[]): Promise<DSEPriceData[]> {
  console.log('Fetching real-time prices from external API...');
  
  if (!isExternalAPIConfigured()) {
    console.log('External API not configured - returning empty array');
    return [];
  }

  try {
    const allPrices: DSEPriceData[] = [];
    
    if (!tradingCodes?.length) {
      console.log('No trading codes specified - cannot fetch without symbols');
      return [];
    }
    
    for (const symbol of tradingCodes) {
      try {
        const response = await fetchFromExternalAPI({ symbol });
        const prices = mapToDSEPriceData(response);
        allPrices.push(...prices);
      } catch (err) {
        console.error(`Error fetching ${symbol}:`, err);
      }
    }
    
    console.log(`Mapped ${allPrices.length} price records`);
    return allPrices;
  } catch (error) {
    console.error('Error fetching prices:', error);
    throw error;
  }
}

// Fetch company fundamentals from external API
async function fetchFundamentals(tradingCode?: string): Promise<DSEFundamentalData[]> {
  console.log('Fetching fundamentals from external API...');
  
  if (!isExternalAPIConfigured()) {
    console.log('External API not configured - returning empty array');
    return [];
  }

  try {
    const params: Record<string, unknown> = { action: 'get_fundamentals' };
    if (tradingCode) {
      params.trading_code = tradingCode;
    }
    
    const response = await fetchFromExternalAPI(params);
    const fundamentals = mapToDSEFundamentalData(response);
    console.log(`Mapped ${fundamentals.length} fundamental records`);
    return fundamentals;
  } catch (error) {
    console.error('Error fetching fundamentals:', error);
    throw error;
  }
}

// Sync prices to database
async function syncPricesToDatabase(prices: DSEPriceData[]): Promise<{ updated: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let updated = 0;
  const errors: string[] = [];

  for (const price of prices) {
    console.log(`Updating price for ${price.trading_code}: close=${price.close_price}, volume=${price.volume}`);
    
    // Use update instead of upsert to only update existing records
    const { data, error, count } = await supabase
      .from('securities')
      .update({
        close_price: price.close_price,
        high_price: price.high_price || null,
        low_price: price.low_price || null,
        open_price: price.open_price || null,
        volume: price.volume || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('trading_code', price.trading_code)
      .select('trading_code');

    if (error) {
      console.error(`Error updating ${price.trading_code}:`, error.message);
      errors.push(`${price.trading_code}: ${error.message}`);
    } else if (data && data.length > 0) {
      console.log(`Successfully updated ${price.trading_code}`);
      updated++;
    } else {
      console.log(`No matching record found for ${price.trading_code}`);
      errors.push(`${price.trading_code}: No matching record in database`);
    }
  }

  console.log(`Synced ${updated} securities, ${errors.length} errors`);
  return { updated, errors };
}

// Sync fundamentals to database
async function syncFundamentalsToDatabase(fundamentals: DSEFundamentalData[]): Promise<{ updated: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let updated = 0;
  const errors: string[] = [];

  for (const fundamental of fundamentals) {
    const { error } = await supabase
      .from('securities')
      .upsert({
        trading_code: fundamental.trading_code,
        eps: fundamental.eps,
        audited_pe: fundamental.audited_pe,
        sector: fundamental.sector,
        category: fundamental.category,
        market_cap: fundamental.market_cap,
        total_securities: fundamental.total_securities,
        director_percent: fundamental.director_percent,
        govt_percent: fundamental.govt_percent,
        institute_percent: fundamental.institute_percent,
        foreign_percent: fundamental.foreign_percent,
        public_percent: fundamental.public_percent,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'trading_code',
      });

    if (error) {
      errors.push(`${fundamental.trading_code}: ${error.message}`);
    } else {
      updated++;
    }
  }

  console.log(`Synced ${updated} fundamentals, ${errors.length} errors`);
  return { updated, errors };
}

// Bulk sync: fetch all trading codes from securities table and sync each one
async function bulkSyncFromExternalAPI(): Promise<{
  total: number;
  synced: number;
  failed: number;
  errors: string[];
  synced_at: string;
}> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Fetch all trading codes from securities table
  const { data: allSecurities, error: fetchError } = await supabase
    .from('securities')
    .select('trading_code')
    .not('trading_code', 'is', null);
  
  if (fetchError) {
    throw new Error(`Failed to fetch securities: ${fetchError.message}`);
  }
  
  const tradingCodes = allSecurities?.map(s => s.trading_code).filter(Boolean) || [];
  console.log(`Starting bulk sync for ${tradingCodes.length} symbols`);
  
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  const batchSize = 10; // Process 10 at a time
  
  for (let i = 0; i < tradingCodes.length; i += batchSize) {
    const batch = tradingCodes.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tradingCodes.length / batchSize)}: ${batch.join(', ')}`);
    
    // Process batch in parallel
    const promises = batch.map(async (symbol) => {
      try {
        const response = await fetchFromExternalAPI({ symbol });
        const prices = mapToDSEPriceData(response);
        const fundamentals = mapToDSEFundamentalData(response);
        
        let priceUpdateSuccess = false;
        
        if (prices.length > 0) {
          const priceResult = await syncPricesToDatabase(prices);
          priceUpdateSuccess = priceResult.updated > 0;
          if (priceResult.errors.length > 0 && priceResult.updated === 0) {
            return { success: false, symbol, error: priceResult.errors.join(', ') };
          }
        }
        
        if (fundamentals.length > 0) {
          await syncFundamentalsToDatabase(fundamentals);
        }
        
        // Success if we got prices AND successfully updated the database
        return { 
          success: priceUpdateSuccess, 
          symbol, 
          error: prices.length === 0 ? 'No data from API' : (!priceUpdateSuccess ? 'No matching record in DB' : undefined) 
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, symbol, error: errorMessage };
      }
    });
    
    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r.success) {
        synced++;
      } else {
        failed++;
        if (errors.length < 50) {
          errors.push(`${r.symbol}: ${r.error || 'No data'}`);
        }
      }
    });
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < tradingCodes.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  console.log(`Bulk sync complete: ${synced} synced, ${failed} failed out of ${tradingCodes.length} total`);
  
  return {
    total: tradingCodes.length,
    synced,
    failed,
    errors: errors.slice(0, 50),
    synced_at: new Date().toISOString()
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTHENTICATION CHECK =====
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's auth token to verify identity
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`User authenticated: ${user.email}`);

    // ===== ADMIN ROLE VERIFICATION =====
    const { data: adminRole, error: roleError } = await supabaseAuth
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError) {
      console.error('Role check error:', roleError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to verify permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!adminRole) {
      console.log(`User ${user.email} is not an admin - access denied`);
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required for market data operations' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Admin access verified for ${user.email}`);
    // ===== END AUTHENTICATION =====

    const { action, trading_code, trading_codes, sync_to_db } = await req.json();

    console.log(`DSE Market Data - Action: ${action}, User: ${user.email}`);

    let result: unknown;

    switch (action) {
      case 'get_realtime_prices':
        // Fetch real-time/latest prices
        const prices = await fetchRealTimePrices(trading_codes);
        if (sync_to_db && prices.length > 0) {
          const syncResult = await syncPricesToDatabase(prices);
          result = { prices, sync: syncResult };
        } else {
          result = { prices };
        }
        break;

      case 'get_fundamentals':
        // Fetch company fundamentals
        const fundamentals = await fetchFundamentals(trading_code);
        if (sync_to_db && fundamentals.length > 0) {
          const syncResult = await syncFundamentalsToDatabase(fundamentals);
          result = { fundamentals, sync: syncResult };
        } else {
          result = { fundamentals };
        }
        break;

      case 'sync_all':
        // Full sync: prices + fundamentals
        const allPrices = await fetchRealTimePrices();
        const allFundamentals = await fetchFundamentals();
        const priceSync = allPrices.length > 0 
          ? await syncPricesToDatabase(allPrices) 
          : { updated: 0, errors: [] };
        const fundSync = allFundamentals.length > 0 
          ? await syncFundamentalsToDatabase(allFundamentals)
          : { updated: 0, errors: [] };
        result = {
          prices: { count: allPrices.length, sync: priceSync },
          fundamentals: { count: allFundamentals.length, sync: fundSync },
          synced_at: new Date().toISOString(),
        };
        break;

      case 'bulk_sync':
        // Bulk sync: fetch all trading codes from DB and sync each from external API
        console.log('Starting bulk_sync action...');
        result = await bulkSyncFromExternalAPI();
        break;

      case 'check_status':
        // Check configuration status
        const connectionInfo = getConnectionInfo();
        result = {
          configured: connectionInfo.configured,
          endpoint: connectionInfo.endpoint,
          message: connectionInfo.configured 
            ? 'External Stock API is configured and ready to fetch data.' 
            : 'External Stock API key not configured. Please add EXTERNAL_STOCK_API_KEY secret.',
        };
        break;

      case 'test_connection':
        // Test the external API connection
        try {
          const testResponse = await fetchFromExternalAPI({ action: 'test' });
          result = {
            success: true,
            message: 'Successfully connected to external stock data API',
            sample_response: testResponse,
          };
        } catch (testError) {
          result = {
            success: false,
            message: testError instanceof Error ? testError.message : 'Connection test failed',
          };
        }
        break;

      default:
        throw new Error(`Unknown action: ${action}. Valid actions: get_realtime_prices, get_fundamentals, sync_all, bulk_sync, check_status, test_connection`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dse-market-data function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage,
      connectionInfo: getConnectionInfo(),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
