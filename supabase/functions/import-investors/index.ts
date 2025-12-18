import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Zod schema for investor record validation
const InvestorRecordSchema = z.object({
  investor_code: z.string().min(1).max(50),
  investor_name: z.string().min(1).max(255),
  investor_type: z.string().max(100).optional().nullable(),
  bo_id: z.string().max(50).optional().nullable(),
  father_spouse_name: z.string().max(255).optional().nullable(),
  mother_name: z.string().max(255).optional().nullable(),
  home_address: z.string().max(500).optional().nullable(),
  date_of_birth: z.string().max(20).optional().nullable(),
  cell_no: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  account_open_date: z.string().max(20).optional().nullable(),
  bank_account_no: z.string().max(50).optional().nullable(),
  bank_name: z.string().max(255).optional().nullable(),
  bank_branch: z.string().max(255).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  trader: z.string().max(255).optional().nullable(),
  account_type: z.string().max(50).optional().nullable(),
  interest_rate: z.number().optional().nullable(),
  brokerage_commission: z.number().optional().nullable(),
});

type InvestorRecord = z.infer<typeof InvestorRecordSchema>;

// Sanitize string to prevent formula injection
function sanitizeString(value: string): string {
  if (!value || typeof value !== 'string') return value;
  // Remove dangerous formula prefixes
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let sanitized = value.trim();
  while (dangerousPrefixes.some(prefix => sanitized.startsWith(prefix))) {
    sanitized = sanitized.slice(1).trim();
  }
  return sanitized;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Step 1: Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create a client with the user's auth token to validate their identity
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error('Auth error:', authError?.message || 'No user found');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Authenticated user: ${user.id} (${user.email})`);

    // Step 2: Check if user has admin role
    const { data: adminRole, error: roleError } = await supabaseAuth
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError) {
      console.error('Role check error:', roleError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to verify permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!adminRole) {
      console.error(`User ${user.email} attempted import without admin role`);
      return new Response(
        JSON.stringify({ error: 'Forbidden - Admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`User ${user.email} authorized as admin`);

    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { records, clearExisting } = await req.json() as { 
      records: unknown[]; 
      clearExisting?: boolean;
    };

    console.log(`Import request from ${user.email}: ${records?.length || 0} records, clearExisting: ${clearExisting}`);

    if (!records || !Array.isArray(records)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: records array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Validate and sanitize all records
    const validRecords: InvestorRecord[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i] as Record<string, unknown>;
      
      // Sanitize string fields
      const sanitizedRecord: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string') {
          sanitizedRecord[key] = sanitizeString(value);
        } else {
          sanitizedRecord[key] = value;
        }
      }

      const result = InvestorRecordSchema.safeParse(sanitizedRecord);
      if (result.success) {
        validRecords.push(result.data);
      } else {
        const errorMsg = `Row ${i + 1}: ${result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
        validationErrors.push(errorMsg);
        if (validationErrors.length >= 10) {
          validationErrors.push('... additional errors truncated');
          break;
        }
      }
    }

    if (validRecords.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No valid records to import',
          validationErrors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clear existing data if requested
    if (clearExisting) {
      console.log(`Admin ${user.email} clearing existing investor data...`);
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

    for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
      const batch = validRecords.slice(i, i + BATCH_SIZE);
      
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

    console.log(`Import complete by ${user.email}: ${totalInserted} records inserted, ${validRecords.length - totalInserted} skipped`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        inserted: totalInserted,
        total: records.length,
        validated: validRecords.length,
        skipped: validationErrors.length,
        errors: errors.length > 0 ? errors : undefined,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined
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
