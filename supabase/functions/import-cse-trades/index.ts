import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TradeRecord {
  trade_date: string;
  investor_code: string;
  instrument: string;
  side: string;
  qty: number;
  price: number;
  settlement_date: string;
  commission: number;
  category: string | null;
  fill_type: string;
  exchange_code: string;
}

// Calculate settlement date (T+2 for most, T+3 for Z category)
function calculateSettlementDate(tradeDate: Date, category: string): string {
  const isZCategory = category?.toUpperCase() === "Z";
  const daysToAdd = isZCategory ? 3 : 2;
  
  let businessDays = 0;
  const result = new Date(tradeDate);
  
  while (businessDays < daysToAdd) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    // Skip weekends (Friday = 5, Saturday = 6 in Bangladesh)
    if (day !== 5 && day !== 6) {
      businessDays++;
    }
  }
  
  return result.toISOString().split("T")[0];
}

// Convert DD/MM/YYYY to YYYY-MM-DD format
function convertDateFormat(dateStr: string): string {
  // Handle DD/MM/YYYY format
  if (dateStr.includes("/")) {
    const [day, month, year] = dateStr.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // Handle DDMMYYYY format
  if (dateStr.length === 8 && !dateStr.includes("-")) {
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

// Parse CSE pipe-delimited content
function parseCseTxt(content: string): { trades: TradeRecord[]; errors: string[] } {
  const trades: TradeRecord[] = [];
  const errors: string[] = [];

  const lines = content.split("\n").filter((line) => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 10) continue;

    try {
      const fields = line.split("|");

      if (fields.length < 11) {
        errors.push(`Line ${i + 1}: Expected at least 11 fields, got ${fields.length}`);
        continue;
      }

      // Field 0: CSE Terminal (e.g., "DHK01", "DHK05")
      const cseTerminal = fields[0].trim();
      if (cseTerminal.length < 4) {
        errors.push(`Line ${i + 1}: Invalid terminal: ${cseTerminal}`);
        continue;
      }

      // Field 2: Security Code
      const securityCode = fields[2].trim().toUpperCase();
      if (!securityCode) {
        errors.push(`Line ${i + 1}: Missing security code`);
        continue;
      }

      // Field 3: Side (B=Buy, S=Sell)
      const sideChar = fields[3].trim().toUpperCase();
      if (sideChar !== "B" && sideChar !== "S") {
        errors.push(`Line ${i + 1}: Invalid side: ${sideChar}`);
        continue;
      }
      const side = sideChar === "S" ? "SELL" : "BUY";

      // Field 4: Quantity
      const quantity = parseInt(fields[4].trim(), 10);
      if (isNaN(quantity) || quantity <= 0) {
        errors.push(`Line ${i + 1}: Invalid quantity: ${fields[4]}`);
        continue;
      }

      // Field 5: Price
      const price = parseFloat(fields[5].trim());
      if (isNaN(price) || price <= 0) {
        errors.push(`Line ${i + 1}: Invalid price: ${fields[5]}`);
        continue;
      }

      // Field 6: Investor Code
      const investorCode = fields[6].trim();
      if (!investorCode) {
        errors.push(`Line ${i + 1}: Missing investor code`);
        continue;
      }

      // Field 10: Trade Date
      const tradeDateRaw = fields[10]?.trim() || "";
      if (!tradeDateRaw) {
        errors.push(`Line ${i + 1}: Missing trade date`);
        continue;
      }

      const tradeDate = convertDateFormat(tradeDateRaw);

      // Field 14: Category flag (N=Normal, B=Block)
      const categoryFlag = fields[14]?.trim() || "N";

      // Calculate settlement date
      const tradeDateObj = new Date(tradeDate);
      const settlementDate = calculateSettlementDate(tradeDateObj, categoryFlag);

      trades.push({
        trade_date: tradeDate,
        investor_code: investorCode,
        instrument: securityCode,
        side,
        qty: quantity,
        price,
        settlement_date: settlementDate,
        commission: 0,
        category: categoryFlag || null,
        fill_type: "FILL",
        exchange_code: cseTerminal, // Use terminal as exchange_code
      });

    } catch (err) {
      errors.push(`Line ${i + 1}: Parse error`);
    }
  }

  return { trades, errors };
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
    const { trade_date, txt_content, replace_existing = false } = body;

    if (!trade_date || !txt_content) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing trade_date or txt_content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the TXT content
    const { trades, errors } = parseCseTxt(txt_content);

    if (trades.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No valid trades found in file",
          parse_errors: errors.slice(0, 10)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If replacing, delete existing CSE trades for the date (DHK% or CTG%)
    if (replace_existing) {
      const { error: deleteError1 } = await supabase
        .from("trade_file")
        .delete()
        .eq("trade_date", trade_date)
        .like("exchange_code", "DHK%");

      const { error: deleteError2 } = await supabase
        .from("trade_file")
        .delete()
        .eq("trade_date", trade_date)
        .like("exchange_code", "CTG%");

      if (deleteError1) console.error("Delete DHK error:", deleteError1);
      if (deleteError2) console.error("Delete CTG error:", deleteError2);
    }

    // Insert trades in batches
    const batchSize = 1000;
    let insertedCount = 0;
    let grossBuy = 0;
    let grossSell = 0;

    for (let i = 0; i < trades.length; i += batchSize) {
      const batch = trades.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from("trade_file")
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
    trades.forEach((t) => {
      const value = t.qty * t.price;
      if (t.side === "BUY") {
        grossBuy += value;
      } else {
        grossSell += value;
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        trade_count: insertedCount,
        gross_buy: grossBuy,
        gross_sell: grossSell,
        trade_date,
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
