import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DepositWithdrawalRecord {
  investor_code: string;
  type: string;
  amount: number;
  description?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify the user token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ success: false, error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { txn_date, records, replace_existing = false } = body;

    if (!txn_date || !records || !Array.isArray(records)) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing txn_date or records array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate records
    const validRecords: DepositWithdrawalRecord[] = [];
    for (const record of records) {
      if (!record.investor_code || !record.type || typeof record.amount !== "number") {
        continue;
      }
      validRecords.push({
        investor_code: String(record.investor_code).trim(),
        type: String(record.type).toUpperCase().trim(),
        amount: record.amount,
        description: record.description || null,
      });
    }

    if (validRecords.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No valid records found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If replacing, delete existing records for the date first
    if (replace_existing) {
      const { error: deleteError } = await supabase
        .from("cash_ledger_txn")
        .delete()
        .eq("txn_date", txn_date);

      if (deleteError) {
        console.error("Delete error:", deleteError);
      }
    }

    // Prepare records for insertion
    const insertRecords = validRecords.map((r) => ({
      investor_code: r.investor_code,
      type: r.type,
      amount: r.amount,
      txn_date: txn_date,
      description: r.description || null,
      reference: null,
    }));

    // Insert in batches
    const batchSize = 500;
    let insertedCount = 0;
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let depositCount = 0;
    let withdrawalCount = 0;

    for (let i = 0; i < insertRecords.length; i += batchSize) {
      const batch = insertRecords.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from("cash_ledger_txn")
        .insert(batch);

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(
          JSON.stringify({ success: false, error: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      insertedCount += batch.length;
    }

    // Calculate totals
    validRecords.forEach((r) => {
      if (r.type === "DEPOSIT") {
        totalDeposits += r.amount;
        depositCount++;
      } else if (r.type === "WITHDRAW") {
        totalWithdrawals += r.amount;
        withdrawalCount++;
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        deposit_count: depositCount,
        withdrawal_count: withdrawalCount,
        total_deposits: totalDeposits,
        total_withdrawals: totalWithdrawals,
        txn_date,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
