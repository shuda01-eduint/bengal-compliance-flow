import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Zod schema for client record validation
const ClientRecordSchema = z.object({
  inv_code: z.string().min(1).max(50).transform(val => val.trim()),
  investor_name: z.string().min(1).max(200).transform(val => val.trim()),
  ledger_balance: z.number().finite(),
  accrued_interest: z.number().finite(),
  current_liabilities: z.number().finite(),
  market_value: z.number().finite(),
  equity: z.number().finite(),
  rm_name: z.string().min(1).max(100).transform(val => val.trim()),
  status: z.string().min(1).max(50).transform(val => val.trim()),
});

type ClientRecord = z.infer<typeof ClientRecordSchema>;

// Sanitize string to prevent formula injection
function sanitizeString(value: string): string {
  if (!value) return value;
  // Remove formula prefixes that could be dangerous in CSV/Excel
  const formulaPrefixes = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let sanitized = value.trim();
  while (formulaPrefixes.some(prefix => sanitized.startsWith(prefix))) {
    sanitized = sanitized.slice(1).trim();
  }
  return sanitized;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Verify JWT and get user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - No authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Create client with user's JWT to verify authentication
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      console.error('Authentication failed:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - Invalid token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    console.log(`Import request from user: ${user.id} (${user.email})`);

    // Check if user has admin role
    const { data: roles, error: roleError } = await supabaseAuth
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError) {
      console.error('Role check error:', roleError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to verify user role' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!roles) {
      console.error(`User ${user.id} attempted import without admin role`);
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden - Admin access required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Use service role client for database operations (after auth verification)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { clients: rawClients, clearExisting } = body as { 
      clients: unknown[]; 
      clearExisting?: boolean 
    };

    if (!Array.isArray(rawClients)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request - clients must be an array' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Received ${rawClients.length} clients to import from admin ${user.email}`);

    // Validate and sanitize each client record
    const validatedClients: ClientRecord[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < rawClients.length; i++) {
      const rawClient = rawClients[i] as Record<string, unknown>;
      
      // Sanitize string fields before validation
      const sanitizedClient = {
        inv_code: sanitizeString(String(rawClient.inv_code || '')),
        investor_name: sanitizeString(String(rawClient.investor_name || '')),
        ledger_balance: typeof rawClient.ledger_balance === 'number' ? rawClient.ledger_balance : 0,
        accrued_interest: typeof rawClient.accrued_interest === 'number' ? rawClient.accrued_interest : 0,
        current_liabilities: typeof rawClient.current_liabilities === 'number' ? rawClient.current_liabilities : 0,
        market_value: typeof rawClient.market_value === 'number' ? rawClient.market_value : 0,
        equity: typeof rawClient.equity === 'number' ? rawClient.equity : 0,
        rm_name: sanitizeString(String(rawClient.rm_name || 'General')),
        status: sanitizeString(String(rawClient.status || 'Active')),
      };

      const result = ClientRecordSchema.safeParse(sanitizedClient);
      
      if (result.success) {
        validatedClients.push(result.data);
      } else {
        if (validationErrors.length < 10) { // Limit error messages
          validationErrors.push(`Row ${i + 1}: ${result.error.errors.map(e => e.message).join(', ')}`);
        }
      }
    }

    if (validatedClients.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No valid client records found',
          validationErrors: validationErrors.slice(0, 10)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Validated ${validatedClients.length} clients, ${validationErrors.length} validation errors`);

    if (clearExisting) {
      console.log(`Admin ${user.email} clearing existing clients...`);
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

    for (let i = 0; i < validatedClients.length; i += batchSize) {
      const batch = validatedClients.slice(i, i + batchSize);
      
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

    console.log(`Import complete by admin ${user.email}. Inserted: ${inserted}, Errors: ${errors.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        inserted, 
        total: validatedClients.length,
        skipped: rawClients.length - validatedClients.length,
        errors: errors.length > 0 ? errors : undefined,
        validationErrors: validationErrors.length > 0 ? validationErrors.slice(0, 10) : undefined
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
