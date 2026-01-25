import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StockDataResponse {
  success: boolean;
  data: {
    symbol: string;
    name: string;
    sector: string;
    category: string;
    market: {
      ltp: number;
      change: number;
      changePercent: number;
      open: number;
      high: number;
      low: number;
      previousClose: number;
      volume: number;
      trade: number;
      valueMn: number;
    };
    fundamentals: {
      marketCap: number;
      authorizedCap: number;
      paidUpCap: number;
      faceValue: number;
      totalShares: number;
      pe: number;
      eps: number;
      nav: number;
      yearHigh: number;
      yearLow: number;
      listingYear: number;
      lastAGM: string;
    };
    history?: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  marketOpen: boolean;
  timestamp: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('STOCK_DATA_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, symbols } = await req.json();

    if (action === 'fetch_single') {
      // Fetch single security data
      const symbol = symbols?.[0];
      if (!symbol) {
        return new Response(
          JSON.stringify({ error: 'Symbol required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch('https://osglgpafsqthqolqbnwu.supabase.co/functions/v1/stock-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ symbol, include_history: false }),
      });

      const data: StockDataResponse = await response.json();
      
      return new Response(
        JSON.stringify(data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'fetch_bulk') {
      // Fetch multiple securities
      const symbolList = symbols || [];
      const results: StockDataResponse[] = [];
      const errors: { symbol: string; error: string }[] = [];

      // Fetch in batches of 5 to avoid rate limiting
      const batchSize = 5;
      for (let i = 0; i < symbolList.length; i += batchSize) {
        const batch = symbolList.slice(i, i + batchSize);
        const batchPromises = batch.map(async (symbol: string) => {
          try {
            const response = await fetch('https://osglgpafsqthqolqbnwu.supabase.co/functions/v1/stock-data', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
              },
              body: JSON.stringify({ symbol, include_history: false }),
            });
            const data: StockDataResponse = await response.json();
            if (data.success) {
              results.push(data);
            } else {
              errors.push({ symbol, error: 'Failed to fetch' });
            }
          } catch (e: unknown) {
            errors.push({ symbol, error: e instanceof Error ? e.message : String(e) });
          }
        });
        await Promise.all(batchPromises);
        
        // Small delay between batches
        if (i + batchSize < symbolList.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      return new Response(
        JSON.stringify({ success: true, data: results, errors }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'sync_to_db') {
      // Fetch and sync to database
      const symbolList = symbols || [];
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      const syncedSecurities: string[] = [];
      const failedSecurities: { symbol: string; error: string }[] = [];

      for (const symbol of symbolList) {
        try {
          const response = await fetch('https://osglgpafsqthqolqbnwu.supabase.co/functions/v1/stock-data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({ symbol, include_history: false }),
          });
          
          const stockData: StockDataResponse = await response.json();
          
          if (stockData.success && stockData.data) {
            const d = stockData.data;
            
            // Upsert to securities table
            const upsertResponse = await fetch(`${supabaseUrl}/rest/v1/securities`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'resolution=merge-duplicates',
              },
              body: JSON.stringify({
                trading_code: d.symbol,
                full_name: d.name,
                sector: d.sector,
                category: d.category,
                margin_category: d.category,
                is_marginable: d.category === 'A' || d.category === 'B',
                haircut_percentage: d.category === 'A' ? 30 : d.category === 'B' ? 40 : 100,
                free_float_mcap: d.fundamentals?.marketCap || null,
                trailing_pe: d.fundamentals?.pe || null,
                last_traded_price: d.market?.ltp || null,
                change_percentage: d.market?.changePercent || null,
                volume: d.market?.volume || null,
                market_cap: d.fundamentals?.marketCap || null,
                eps: d.fundamentals?.eps || null,
                pe_ratio: d.fundamentals?.pe || null,
                year_high: d.fundamentals?.yearHigh || null,
                year_low: d.fundamentals?.yearLow || null,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }),
            });

            if (upsertResponse.ok) {
              syncedSecurities.push(symbol);
            } else {
              const errorText = await upsertResponse.text();
              failedSecurities.push({ symbol, error: errorText });
            }
          } else {
            failedSecurities.push({ symbol, error: 'API returned no data' });
          }
        } catch (e: unknown) {
          failedSecurities.push({ symbol, error: e instanceof Error ? e.message : String(e) });
        }
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return new Response(
        JSON.stringify({
          success: true,
          synced: syncedSecurities,
          failed: failedSecurities,
          total: symbolList.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use: fetch_single, fetch_bulk, or sync_to_db' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
