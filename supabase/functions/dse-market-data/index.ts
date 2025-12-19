import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DSE MDS API Configuration - Update these when you get access
const DSE_API_BASE_URL = Deno.env.get('DSE_API_BASE_URL') || 'https://api.dse.com.bd'; // Placeholder URL
const DSE_API_KEY = Deno.env.get('DSE_API_KEY') || '';

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
  authorized_capital?: number;
  paid_up_capital?: number;
  face_value?: number;
  total_securities?: number;
  director_percent?: number;
  govt_percent?: number;
  institute_percent?: number;
  foreign_percent?: number;
  public_percent?: number;
}

// Helper function to make DSE API requests
async function fetchFromDSE(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  if (!DSE_API_KEY) {
    throw new Error('DSE_API_KEY is not configured. Please add your DSE MDS API key.');
  }

  const url = new URL(`${DSE_API_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  console.log(`Fetching from DSE: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${DSE_API_KEY}`,
      'Content-Type': 'application/json',
      // Add any other required headers based on DSE API documentation
      // 'X-API-Key': DSE_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`DSE API Error: ${response.status} - ${errorText}`);
    throw new Error(`DSE API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Fetch real-time/latest market prices
async function fetchRealTimePrices(tradingCodes?: string[]): Promise<DSEPriceData[]> {
  console.log('Fetching real-time prices from DSE...');
  
  // TODO: Replace with actual DSE API endpoint when available
  // Example endpoint structure (adjust based on actual DSE API documentation):
  // const endpoint = '/api/v1/market/prices';
  // const data = await fetchFromDSE(endpoint);
  
  // Placeholder: Return mock structure showing expected data format
  console.log('DSE API not configured - returning placeholder structure');
  
  return [{
    trading_code: 'PLACEHOLDER',
    close_price: 0,
    high_price: 0,
    low_price: 0,
    open_price: 0,
    volume: 0,
    value: 0,
    trade_count: 0,
    last_trade_price: 0,
    change: 0,
    change_percent: 0,
  }];
}

// Fetch end-of-day (EOD) historical data
async function fetchEODData(tradingCode: string, fromDate?: string, toDate?: string): Promise<any[]> {
  console.log(`Fetching EOD data for ${tradingCode}...`);
  
  // TODO: Replace with actual DSE API endpoint when available
  // Example endpoint structure:
  // const endpoint = `/api/v1/market/history/${tradingCode}`;
  // const params = { from: fromDate, to: toDate };
  // const data = await fetchFromDSE(endpoint, params);
  
  console.log('DSE API not configured - returning placeholder structure');
  
  return [{
    date: new Date().toISOString().split('T')[0],
    trading_code: tradingCode,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    value: 0,
  }];
}

// Fetch company fundamentals
async function fetchFundamentals(tradingCode?: string): Promise<DSEFundamentalData[]> {
  console.log('Fetching fundamentals from DSE...');
  
  // TODO: Replace with actual DSE API endpoint when available
  // Example endpoint structure:
  // const endpoint = tradingCode 
  //   ? `/api/v1/company/${tradingCode}/fundamentals`
  //   : '/api/v1/market/fundamentals';
  // const data = await fetchFromDSE(endpoint);
  
  console.log('DSE API not configured - returning placeholder structure');
  
  return [{
    trading_code: tradingCode || 'PLACEHOLDER',
    eps: 0,
    audited_pe: 0,
    sector: 'Unknown',
    category: 'Unknown',
    market_cap: 0,
    total_securities: 0,
    director_percent: 0,
    govt_percent: 0,
    institute_percent: 0,
    foreign_percent: 0,
    public_percent: 0,
  }];
}

// Sync prices to database
async function syncPricesToDatabase(prices: DSEPriceData[]): Promise<{ updated: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let updated = 0;
  const errors: string[] = [];

  for (const price of prices) {
    const { error } = await supabase
      .from('securities')
      .upsert({
        trading_code: price.trading_code,
        close_price: price.close_price,
        volume: price.volume,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'trading_code',
      });

    if (error) {
      errors.push(`${price.trading_code}: ${error.message}`);
    } else {
      updated++;
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
        total_securities: fundamental.total_securities,
        director_percent: fundamental.director_percent,
        govt_percent: fundamental.govt_percent,
        institute_percent: fundamental.institute_percent,
        foreign_percent: fundamental.foreign_percent,
        public_percent: fundamental.public_percent,
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, trading_code, trading_codes, from_date, to_date, sync_to_db } = await req.json();

    console.log(`DSE Market Data - Action: ${action}`);

    let result: any;

    switch (action) {
      case 'get_realtime_prices':
        // Fetch real-time/latest prices
        const prices = await fetchRealTimePrices(trading_codes);
        if (sync_to_db) {
          const syncResult = await syncPricesToDatabase(prices);
          result = { prices, sync: syncResult };
        } else {
          result = { prices };
        }
        break;

      case 'get_eod_data':
        // Fetch end-of-day historical data for a specific security
        if (!trading_code) {
          throw new Error('trading_code is required for EOD data');
        }
        const eodData = await fetchEODData(trading_code, from_date, to_date);
        result = { eod_data: eodData };
        break;

      case 'get_fundamentals':
        // Fetch company fundamentals
        const fundamentals = await fetchFundamentals(trading_code);
        if (sync_to_db) {
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
        const priceSync = await syncPricesToDatabase(allPrices);
        const fundSync = await syncFundamentalsToDatabase(allFundamentals);
        result = {
          prices: { count: allPrices.length, sync: priceSync },
          fundamentals: { count: allFundamentals.length, sync: fundSync },
          synced_at: new Date().toISOString(),
        };
        break;

      case 'check_status':
        // Check API configuration status
        result = {
          configured: !!DSE_API_KEY,
          api_url: DSE_API_BASE_URL,
          message: DSE_API_KEY 
            ? 'DSE API is configured and ready' 
            : 'DSE API key not configured. Add DSE_API_KEY and DSE_API_BASE_URL secrets.',
        };
        break;

      default:
        throw new Error(`Unknown action: ${action}. Valid actions: get_realtime_prices, get_eod_data, get_fundamentals, sync_all, check_status`);
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
      hint: 'Ensure DSE_API_KEY and DSE_API_BASE_URL secrets are configured when you receive API access.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
