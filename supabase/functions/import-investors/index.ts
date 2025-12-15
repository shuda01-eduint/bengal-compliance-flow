import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvestorRecord {
  investor_code: string;
  investor_name: string;
  investor_type?: string;
  bo_id?: string;
  father_spouse_name?: string;
  mother_name?: string;
  home_address?: string;
  date_of_birth?: string;
  cell_no?: string;
  email?: string;
  account_open_date?: string;
  bank_account_no?: string;
  bank_name?: string;
  bank_branch?: string;
  status?: string;
  trader?: string;
  account_type?: string;
  interest_rate?: number;
  brokerage_commission?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { records, clearExisting } = await req.json() as { 
      records: InvestorRecord[]; 
      clearExisting?: boolean;
    };

    console.log(`Importing ${records.length} investor records, clearExisting: ${clearExisting}`);

    if (!records || !Array.isArray(records)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: records array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clear existing data if requested
    if (clearExisting) {
      console.log('Clearing existing investor data...');
      const { error: deleteError } = await supabase
        .from('investors')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
      
      if (deleteError) {
        console.error('Error clearing investors:', deleteError);
        return new Response(
          JSON.stringify({ error: `Failed to clear existing data: ${deleteError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Process in batches of 500
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      // Map records to database format
      const mappedRecords = batch.map((record) => ({
        investor_code: record.investor_code,
        investor_name: record.investor_name,
        investor_type: record.investor_type || null,
        bo_id: record.bo_id || null,
        father_spouse_name: record.father_spouse_name || null,
        mother_name: record.mother_name || null,
        home_address: record.home_address || null,
        date_of_birth: record.date_of_birth || null,
        cell_no: record.cell_no || null,
        email: record.email || null,
        account_open_date: record.account_open_date || null,
        bank_account_no: record.bank_account_no || null,
        bank_name: record.bank_name || null,
        bank_branch: record.bank_branch || null,
        status: record.status || 'Active',
        trader: record.trader || null,
        account_type: record.account_type || null,
        interest_rate: record.interest_rate ?? 0,
        brokerage_commission: record.brokerage_commission ?? 0,
      }));

      const { data, error } = await supabase
        .from('investors')
        .upsert(mappedRecords, { 
          onConflict: 'investor_code',
          ignoreDuplicates: false 
        })
        .select();

      if (error) {
        console.error(`Batch ${i / BATCH_SIZE + 1} error:`, error);
        errors.push(`Batch ${i / BATCH_SIZE + 1}: ${error.message}`);
      } else {
        totalInserted += data?.length || 0;
        console.log(`Batch ${i / BATCH_SIZE + 1}: Inserted ${data?.length || 0} records`);
      }
    }

    console.log(`Import complete: ${totalInserted} records inserted`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        inserted: totalInserted,
        total: records.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Import error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
