import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClientRecord {
  inv_code: string;
  investor_name: string;
  ledger_balance: number;
  accrued_interest: number;
  current_liabilities: number;
  market_value: number;
  equity: number;
  rm_name: string;
  status: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { clients, clearExisting } = await req.json() as { 
      clients: ClientRecord[]; 
      clearExisting?: boolean 
    };

    console.log(`Received ${clients.length} clients to import`);

    if (clearExisting) {
      console.log('Clearing existing clients...');
      const { error: deleteError } = await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteError) {
        console.error('Error clearing clients:', deleteError);
        throw new Error(`Failed to clear existing clients: ${deleteError.message}`);
      }
    }

    // Insert in batches of 500
    const batchSize = 500;
    let inserted = 0;
    let errors: string[] = [];

    for (let i = 0; i < clients.length; i += batchSize) {
      const batch = clients.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('clients')
        .insert(batch)
        .select('id');

      if (error) {
        console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
        errors.push(`Batch ${i / batchSize + 1}: ${error.message}`);
      } else {
        inserted += data?.length || 0;
        console.log(`Inserted batch ${i / batchSize + 1}: ${data?.length || 0} records`);
      }
    }

    console.log(`Import complete. Inserted: ${inserted}, Errors: ${errors.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        inserted, 
        total: clients.length,
        errors: errors.length > 0 ? errors : undefined 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Import error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
