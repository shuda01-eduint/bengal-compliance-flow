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

// Parse DSE XML content
function parseDseXml(content: string): { trades: TradeRecord[]; errors: string[] } {
  const trades: TradeRecord[] = [];
  const errors: string[] = [];

  // Use regex-based parsing for Deno (no DOMParser)
  const normalizeKeyRegex = /[\s_-]+/g;
  const commaRegex = /,/g;

  // Try to parse as Excel XML format (Row/Cell structure)
  const rowMatches = content.match(/<Row[^>]*>[\s\S]*?<\/Row>/gi) || [];
  
  if (rowMatches.length > 1) {
    // Parse Excel XML format
    const headers: string[] = [];
    
    // Extract headers from first row
    const headerRow = rowMatches[0];
    if (!headerRow) return { trades, errors };
    const headerCellMatches = headerRow.match(/<Cell[^>]*>[\s\S]*?<\/Cell>/gi) || [];
    
    headerCellMatches.forEach((cell) => {
      const dataMatch = cell.match(/<Data[^>]*>([\s\S]*?)<\/Data>/i);
      if (dataMatch) {
        headers.push(dataMatch[1].trim());
      }
    });

    // Parse data rows
    for (let i = 1; i < rowMatches.length; i++) {
      const row = rowMatches[i];
      const cellMatches = row.match(/<Cell[^>]*>[\s\S]*?<\/Cell>/gi) || [];
      const rowData: Record<string, string> = {};
      
      let currentIndex = 0;
      cellMatches.forEach((cell) => {
        // Check for ss:Index attribute
        const indexMatch = cell.match(/ss:Index="(\d+)"/i);
        if (indexMatch) {
          currentIndex = parseInt(indexMatch[1]) - 1;
        }
        
        const dataMatch = cell.match(/<Data[^>]*>([\s\S]*?)<\/Data>/i);
        if (dataMatch && headers[currentIndex]) {
          rowData[headers[currentIndex]] = dataMatch[1].trim();
        }
        currentIndex++;
      });

      const trade = parseRowToTrade(rowData);
      if (trade) {
        trades.push(trade);
      }
    }
  } else {
    // Try Detail element format
    const detailMatches = content.match(/<Detail[^>]*\/>/gi) || 
                          content.match(/<Detail[^>]*>[\s\S]*?<\/Detail>/gi) || [];
    
    for (const detail of detailMatches) {
      const rowData: Record<string, string> = {};
      
      // Extract attributes
      const attrMatches = detail.matchAll(/(\w+)="([^"]*)"/gi);
      for (const match of attrMatches) {
        rowData[match[1]] = match[2];
      }
      
      const trade = parseRowToTrade(rowData);
      if (trade) {
        trades.push(trade);
      }
    }
  }

  return { trades, errors };
}

function parseRowToTrade(row: Record<string, string>): TradeRecord | null {
  const getString = (keys: string[]) => {
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().replace(/[\s_-]+/g, "");
      for (const rowKey of Object.keys(row)) {
        if (rowKey.toLowerCase().replace(/[\s_-]+/g, "") === normalizedKey) {
          const val = row[rowKey]?.trim();
          return val === "-" ? "" : val || "";
        }
      }
    }
    return "";
  };

  const getNumber = (keys: string[]) => {
    const val = getString(keys);
    const cleaned = val.replace(/,/g, "");
    return cleaned === "-" ? 0 : parseFloat(cleaned) || 0;
  };

  // Filter: only include EXEC actions
  const action = getString(["Action"]).toUpperCase();
  if (action !== "EXEC") return null;

  // Filter: must have fill_type
  const fillType = getString(["FillType"]);
  if (!fillType) return null;

  const clientCode = getString(["ClientCode"]);
  const securityCode = getString(["SecurityCode"]);
  if (!clientCode || !securityCode) return null;

  const sideRaw = getString(["Side"]).toUpperCase();
  const side = sideRaw === "S" ? "SELL" : "BUY";

  const quantity = getNumber(["Quantity"]);
  const price = getNumber(["Price"]);

  // Parse date
  const dateRaw = getString(["Date"]);
  let tradeDate = dateRaw;

  // Handle DD/MM/YYYY format
  if (dateRaw.includes("/")) {
    const parts = dateRaw.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      tradeDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  // Handle 8-digit formats
  else if (dateRaw.length === 8 && !dateRaw.includes("-")) {
    if (dateRaw.startsWith("19") || dateRaw.startsWith("20")) {
      tradeDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    } else {
      const day = dateRaw.substring(0, 2);
      const month = dateRaw.substring(2, 4);
      const year = dateRaw.substring(4, 8);
      tradeDate = `${year}-${month}-${day}`;
    }
  }
  // Handle YYYY-MM-DD (already correct)
  else if (!dateRaw.includes("-") && dateRaw.length !== 10) {
    return null; // Invalid date
  }

  const board = getString(["Board"]);
  const category = getString(["Category"]) || "N";

  // Calculate settlement date
  const tradeDateObj = new Date(tradeDate);
  const settlementDate = calculateSettlementDate(tradeDateObj, category);

  return {
    trade_date: tradeDate,
    investor_code: clientCode,
    instrument: securityCode.toUpperCase(),
    side,
    qty: quantity,
    price,
    settlement_date: settlementDate,
    commission: 0,
    category: category || null,
    fill_type: board || "FILL", // Store board info in fill_type
    exchange_code: "DSE", // Always DSE for XML imports
  };
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
    const { trade_date, xml_content, replace_existing = false } = body;

    if (!trade_date || !xml_content) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing trade_date or xml_content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the XML content
    const { trades, errors } = parseDseXml(xml_content);

    if (trades.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No valid trades found in XML",
          parse_errors: errors.slice(0, 10)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If replacing, delete existing DSE trades for the date
    if (replace_existing) {
      const { error: deleteError } = await supabase
        .from("trade_file")
        .delete()
        .eq("trade_date", trade_date)
        .eq("exchange_code", "DSE");

      if (deleteError) {
        console.error("Delete error:", deleteError);
      }
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
