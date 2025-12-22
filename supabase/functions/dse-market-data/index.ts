import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DSE MDS Configuration from secrets
const DSE_MDS_IP = Deno.env.get('DSE_MDS_IP') || '';
const DSE_MDS_DATABASE = Deno.env.get('DSE_MDS_DATABASE') || '';
const DSE_MDS_USERNAME = Deno.env.get('DSE_MDS_USERNAME') || '';
const DSE_MDS_PASSWORD = Deno.env.get('DSE_MDS_PASSWORD') || '';

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

// Check if DSE MDS is configured
function isDSEConfigured(): boolean {
  return !!(DSE_MDS_IP && DSE_MDS_DATABASE && DSE_MDS_USERNAME && DSE_MDS_PASSWORD);
}

// Get DSE MDS connection info (masked for security)
function getConnectionInfo(): { configured: boolean; ip: string; database: string; username: string } {
  return {
    configured: isDSEConfigured(),
    ip: DSE_MDS_IP ? `${DSE_MDS_IP.split('.').slice(0, 2).join('.')}.*.*` : 'Not configured',
    database: DSE_MDS_DATABASE || 'Not configured',
    username: DSE_MDS_USERNAME || 'Not configured',
  };
}

// Note: Deno doesn't have native SQL Server support, so we'll use a REST API proxy approach
// or direct TDS protocol. For now, we'll set up the structure for when a SQL Server 
// connection library becomes available or an API proxy is set up.

// Helper function to query DSE MDS database
// This requires either:
// 1. A REST API proxy service that connects to SQL Server
// 2. A native SQL Server library for Deno (limited options)
// 3. An external API service that exposes the MDS data
async function queryDSEMDS(query: string): Promise<any[]> {
  if (!isDSEConfigured()) {
    throw new Error('DSE MDS credentials are not fully configured');
  }

  console.log(`Attempting to query DSE MDS at ${DSE_MDS_IP}...`);
  console.log(`Database: ${DSE_MDS_DATABASE}, User: ${DSE_MDS_USERNAME}`);
  
  // For SQL Server connectivity in Deno Edge Functions, we have options:
  // 1. Use an HTTP proxy service that connects to SQL Server
  // 2. Use a cloud-based SQL Server connector service
  
  // For now, we'll prepare the query structure but note that direct MSSQL
  // connectivity requires additional infrastructure
  
  throw new Error(
    'Direct SQL Server connection not available in Edge Functions. ' +
    'Options: 1) Set up an API proxy service, 2) Use Azure SQL Data Sync, ' +
    '3) Use a scheduled job to export data to a compatible format.'
  );
}

// Fetch real-time/latest market prices from DSE MDS
async function fetchRealTimePrices(tradingCodes?: string[]): Promise<DSEPriceData[]> {
  console.log('Fetching real-time prices from DSE MDS...');
  
  if (!isDSEConfigured()) {
    console.log('DSE MDS not configured - returning empty array');
    return [];
  }

  // Example SQL query structure for DSE MDS
  // Adjust based on actual MDS database schema
  const whereClause = tradingCodes?.length 
    ? `WHERE trading_code IN ('${tradingCodes.join("','")}')`
    : '';
  
  const query = `
    SELECT 
      trading_code,
      close_price,
      high_price,
      low_price,
      open_price,
      volume,
      value,
      trade_count,
      last_trade_price,
      change,
      change_percent
    FROM market_prices
    ${whereClause}
  `;
  
  try {
    const results = await queryDSEMDS(query);
    return results.map((row: any) => ({
      trading_code: row.trading_code,
      close_price: parseFloat(row.close_price) || 0,
      high_price: parseFloat(row.high_price) || undefined,
      low_price: parseFloat(row.low_price) || undefined,
      open_price: parseFloat(row.open_price) || undefined,
      volume: parseInt(row.volume) || undefined,
      value: parseFloat(row.value) || undefined,
      trade_count: parseInt(row.trade_count) || undefined,
      last_trade_price: parseFloat(row.last_trade_price) || undefined,
      change: parseFloat(row.change) || undefined,
      change_percent: parseFloat(row.change_percent) || undefined,
    }));
  } catch (error) {
    console.error('Error fetching prices:', error);
    throw error;
  }
}

// Fetch end-of-day (EOD) historical data
async function fetchEODData(tradingCode: string, fromDate?: string, toDate?: string): Promise<any[]> {
  console.log(`Fetching EOD data for ${tradingCode}...`);
  
  if (!isDSEConfigured()) {
    console.log('DSE MDS not configured - returning empty array');
    return [];
  }

  // Example SQL query structure
  const dateFilter = [];
  if (fromDate) dateFilter.push(`trade_date >= '${fromDate}'`);
  if (toDate) dateFilter.push(`trade_date <= '${toDate}'`);
  
  const whereClause = `WHERE trading_code = '${tradingCode}'${dateFilter.length ? ' AND ' + dateFilter.join(' AND ') : ''}`;
  
  const query = `
    SELECT 
      trade_date,
      trading_code,
      open_price,
      high_price,
      low_price,
      close_price,
      volume,
      value
    FROM eod_prices
    ${whereClause}
    ORDER BY trade_date DESC
  `;
  
  try {
    const results = await queryDSEMDS(query);
    return results.map((row: any) => ({
      date: row.trade_date,
      trading_code: row.trading_code,
      open: parseFloat(row.open_price) || 0,
      high: parseFloat(row.high_price) || 0,
      low: parseFloat(row.low_price) || 0,
      close: parseFloat(row.close_price) || 0,
      volume: parseInt(row.volume) || 0,
      value: parseFloat(row.value) || 0,
    }));
  } catch (error) {
    console.error('Error fetching EOD data:', error);
    throw error;
  }
}

// Fetch company fundamentals
async function fetchFundamentals(tradingCode?: string): Promise<DSEFundamentalData[]> {
  console.log('Fetching fundamentals from DSE MDS...');
  
  if (!isDSEConfigured()) {
    console.log('DSE MDS not configured - returning empty array');
    return [];
  }

  const whereClause = tradingCode ? `WHERE trading_code = '${tradingCode}'` : '';
  
  const query = `
    SELECT 
      trading_code,
      eps,
      audited_pe,
      sector,
      category,
      market_cap,
      total_securities,
      director_percent,
      govt_percent,
      institute_percent,
      foreign_percent,
      public_percent
    FROM company_fundamentals
    ${whereClause}
  `;
  
  try {
    const results = await queryDSEMDS(query);
    return results.map((row: any) => ({
      trading_code: row.trading_code,
      eps: parseFloat(row.eps) || undefined,
      audited_pe: parseFloat(row.audited_pe) || undefined,
      sector: row.sector || undefined,
      category: row.category || undefined,
      market_cap: parseFloat(row.market_cap) || undefined,
      total_securities: parseInt(row.total_securities) || undefined,
      director_percent: parseFloat(row.director_percent) || undefined,
      govt_percent: parseFloat(row.govt_percent) || undefined,
      institute_percent: parseFloat(row.institute_percent) || undefined,
      foreign_percent: parseFloat(row.foreign_percent) || undefined,
      public_percent: parseFloat(row.public_percent) || undefined,
    }));
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
    const { error } = await supabase
      .from('securities')
      .upsert({
        trading_code: price.trading_code,
        close_price: price.close_price,
        high_price: price.high_price,
        low_price: price.low_price,
        open_price: price.open_price,
        volume: price.volume,
        last_synced_at: new Date().toISOString(),
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
        if (sync_to_db && prices.length > 0) {
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

      case 'check_status':
        // Check configuration status
        const connectionInfo = getConnectionInfo();
        result = {
          configured: connectionInfo.configured,
          connection: {
            ip: connectionInfo.ip,
            database: connectionInfo.database,
            username: connectionInfo.username,
          },
          message: connectionInfo.configured 
            ? 'DSE MDS credentials are configured. Note: Direct SQL Server connection requires additional infrastructure (API proxy or scheduled sync job).' 
            : 'DSE MDS credentials not fully configured. Required: DSE_MDS_IP, DSE_MDS_DATABASE, DSE_MDS_USERNAME, DSE_MDS_PASSWORD',
          note: 'Edge Functions cannot directly connect to SQL Server. Consider: 1) API proxy service, 2) Scheduled ETL job, 3) Azure Data Sync'
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
      connectionInfo: getConnectionInfo(),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
