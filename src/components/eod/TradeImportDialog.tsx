import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sanitizeString } from "@/lib/validation-schemas";

interface ParsedTrade {
  cse_terminal: string;
  dp_code: string;
  investor_code: string;
  full_investor_code: string;
  security_code: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  value: number;
  trade_date: string;
  trade_time: string;
  settlement_date: string;
  settlement_time: string;
  category_flag: string;
  exec_id: string;
  file_name: string;
}

interface ValidationError {
  line: number;
  message: string;
  raw?: string;
}

interface TradeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "complete";

// Convert DD/MM/YYYY to YYYYMMDD format
function convertDateFormat(dateStr: string): string {
  // Handle DD/MM/YYYY format
  if (dateStr.includes("/")) {
    const [day, month, year] = dateStr.split("/");
    return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
  }
  // Handle DDMMYYYY format
  if (dateStr.length === 8 && !dateStr.includes("-")) {
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    return `${year}${month}${day}`;
  }
  // Handle YYYY-MM-DD format (already standard)
  if (dateStr.includes("-")) {
    return dateStr.replace(/-/g, "");
  }
  return dateStr;
}

// Convert various date formats to YYYY-MM-DD display format
function formatDateForDisplay(dateStr: string): string {
  // Handle DD/MM/YYYY format
  if (dateStr.includes("/")) {
    const [day, month, year] = dateStr.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // Handle YYYYMMDD format
  if (dateStr.length === 8 && !dateStr.includes("-")) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

// Convert HHMMSS to HH:MM:SS display format
function formatTimeForDisplay(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  const hour = hhmmss.substring(0, 2);
  const min = hhmmss.substring(2, 4);
  const sec = hhmmss.substring(4, 6);
  return `${hour}:${min}:${sec}`;
}

// Parse a single line of CSE pipe-delimited trade data
// Format: Terminal|ID|Security|Side|Qty|Price|InvestorCode|||Seq|TradeDate|TradeTime|SettleDate|SettleTime|Category
// The file has 15 fields (indices 0-14)
function parsePipeDelimitedLine(line: string, lineNumber: number, fileName: string): ParsedTrade | ValidationError {
  const trimmed = line.trim();
  
  if (!trimmed || trimmed.length < 10) {
    return { line: lineNumber, message: `Line too short`, raw: trimmed.substring(0, 50) };
  }

  try {
    const fields = trimmed.split("|");
    
    if (fields.length < 11) {
      return { line: lineNumber, message: `Expected at least 11 pipe-delimited fields, got ${fields.length}`, raw: trimmed.substring(0, 60) };
    }

    // Field 0: CSE Terminal (e.g., "DHK01", "DHK05", "DHK11")
    const cseTerminal = fields[0].trim();
    if (cseTerminal.length < 4) {
      return { line: lineNumber, message: `Invalid CSE Terminal: ${cseTerminal}`, raw: trimmed.substring(0, 60) };
    }
    // Extract DP code from terminal (e.g., "01" from "DHK01")
    const dpCode = cseTerminal.replace(/^\D+/, ''); // Remove leading non-digits

    // Field 1: Unknown ID (ignored, e.g., "14028")
    
    // Field 2: Security Code (e.g., "LOVELLO", "SPCERAMICS")
    const securityCode = fields[2].trim().toUpperCase();
    if (!securityCode) {
      return { line: lineNumber, message: `Missing security code`, raw: trimmed.substring(0, 60) };
    }

    // Field 3: Side (B=Buy, S=Sell)
    const sideChar = fields[3].trim().toUpperCase();
    if (sideChar !== "B" && sideChar !== "S") {
      return { line: lineNumber, message: `Invalid side: ${sideChar}, expected B or S`, raw: trimmed.substring(0, 60) };
    }
    const side: "BUY" | "SELL" = sideChar === "S" ? "SELL" : "BUY";

    // Field 4: Quantity
    const quantityStr = fields[4].trim();
    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity) || quantity <= 0) {
      return { line: lineNumber, message: `Invalid quantity: ${quantityStr}`, raw: trimmed.substring(0, 60) };
    }

    // Field 5: Price
    const priceStr = fields[5].trim();
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      return { line: lineNumber, message: `Invalid price: ${priceStr}`, raw: trimmed.substring(0, 60) };
    }

    // Field 6: Investor Code (e.g., "GZ44", "NJ21", "13657")
    const investorCode = fields[6].trim();
    if (!investorCode) {
      return { line: lineNumber, message: `Missing investor code`, raw: trimmed.substring(0, 60) };
    }
    // Full investor code = DP code + investor code (e.g., "01" + "GZ44" = "01GZ44")
    const fullInvestorCode = dpCode + investorCode;

    // Fields 7-8: Empty (unused)
    
    // Field 9: Trade Sequence (e.g., "22")
    const tradeSequence = fields[9]?.trim() || "";
    
    // Field 10: Trade Date (DD/MM/YYYY format like "13/01/2026")
    const tradeDateRaw = fields[10]?.trim() || "";
    if (!tradeDateRaw) {
      return { line: lineNumber, message: `Missing trade date`, raw: trimmed.substring(0, 60) };
    }
    
    // Calculate value
    const value = quantity * price;
    
    // Convert date to YYYYMMDD format
    const tradeDateFormatted = convertDateFormat(tradeDateRaw);
    
    // Generate unique exec_id using terminal, investor, security, date, and trade sequence
    const execId = `CSE_${cseTerminal}_${fullInvestorCode}_${securityCode}_${tradeDateFormatted}_${side}_${quantity}_${price}_${tradeSequence}`;

    // Field 11: Trade time (HH:MM:SS)
    const tradeTime = fields[11]?.trim() || "";
    // Field 12: Settlement date
    const settlementDateRaw = fields[12]?.trim() || "";
    // Field 13: Settlement time
    const settlementTime = fields[13]?.trim() || "";
    // Field 14: Category flag (N=Normal, B=Block)
    const categoryFlag = fields[14]?.trim() || "N";

    return {
      cse_terminal: cseTerminal,
      dp_code: dpCode,
      investor_code: investorCode,
      full_investor_code: fullInvestorCode,
      security_code: securityCode,
      side,
      quantity,
      price,
      value,
      trade_date: tradeDateFormatted,
      trade_time: tradeTime,
      settlement_date: settlementDateRaw ? convertDateFormat(settlementDateRaw) : tradeDateFormatted,
      settlement_time: settlementTime,
      category_flag: categoryFlag,
      exec_id: execId,
      file_name: fileName,
    };
  } catch (error: any) {
    return { line: lineNumber, message: `Parse error: ${error.message}`, raw: trimmed.substring(0, 50) };
  }
}

// Pre-compiled regex for performance
const normalizeKeyRegex = /[\s_-]+/g;
const commaRegex = /,/g;

// Parse DSE XML content (Excel-style Row/Cell or Detail attributes)
function parseDseXmlContent(
  content: string,
  fileName: string
): { trades: ParsedTrade[]; errors: ValidationError[] } {
  const trades: ParsedTrade[] = [];
  const errors: ValidationError[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    errors.push({
      line: 0,
      message: "Invalid XML format - file may be HTML or corrupted",
    });
    return { trades, errors };
  }

  const allRowData: Record<string, unknown>[] = [];

  // Try Row/Cell format (Excel XML)
  let rows = doc.getElementsByTagName("Row");
  if (rows.length === 0) {
    rows = doc.getElementsByTagName("row");
  }

  if (rows.length > 0) {
    // Extract headers from first row
    const headerRow = rows[0];
    const headerCells = headerRow.getElementsByTagName("Cell");
    const headers: string[] = [];

    let headerIndex = 0;
    for (let i = 0; i < headerCells.length; i++) {
      const cell = headerCells[i];
      const indexAttr = cell.getAttribute("ss:Index");
      if (indexAttr) {
        headerIndex = parseInt(indexAttr) - 1;
      }
      const dataEl = cell.getElementsByTagName("Data")[0];
      headers[headerIndex] = dataEl?.textContent?.trim() || "";
      headerIndex++;
    }

    // Parse data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.getElementsByTagName("Cell");
      const rowData: Record<string, unknown> = {};

      let currentIndex = 0;
      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];
        const indexAttr = cell.getAttribute("ss:Index");
        if (indexAttr) {
          currentIndex = parseInt(indexAttr) - 1;
        }
        const dataEl = cell.getElementsByTagName("Data")[0];
        if (headers[currentIndex]) {
          rowData[headers[currentIndex]] = dataEl?.textContent?.trim() || "";
        }
        currentIndex++;
      }
      allRowData.push(rowData);
    }
  } else {
    // Try Detail elements (attribute-based)
    const detailElements = doc.getElementsByTagName("Detail");

    if (detailElements.length > 0) {
      for (let i = 0; i < detailElements.length; i++) {
        const element = detailElements[i];
        const rowData: Record<string, unknown> = {};
        for (let j = 0; j < element.attributes.length; j++) {
          const attr = element.attributes[j];
          rowData[attr.name] = attr.value;
        }
        allRowData.push(rowData);
      }
    } else {
      // Try generic elements (Trade, Record, Item)
      const tradeElements = doc.querySelectorAll(
        "Trade, trade, Record, record, Item, item"
      );
      tradeElements.forEach((element) => {
        const rowData: Record<string, unknown> = {};
        Array.from(element.attributes).forEach((attr) => {
          rowData[attr.name] = attr.value;
        });
        element.childNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const el = node as Element;
            rowData[el.tagName] = el.textContent?.trim() || "";
          }
        });
        allRowData.push(rowData);
      });
    }
  }

  // Process each row and convert to ParsedTrade
  for (let i = 0; i < allRowData.length; i++) {
    const row = allRowData[i];
    const trade = parseXmlRowToTrade(row, i + 1, fileName);

    if (trade) {
      trades.push(trade);
    }

    // Yield to UI every 10,000 rows for large files
    if (i % 10000 === 0 && i > 0) {
      // Synchronous processing for speed - progress updates handled elsewhere
    }
  }

  return { trades, errors };
}

// Parse a single XML row to ParsedTrade
function parseXmlRowToTrade(
  row: Record<string, unknown>,
  lineNumber: number,
  fileName: string
): ParsedTrade | null {
  // Create normalized key mapping
  const rowNormalized: Record<string, unknown> = {};
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    rowNormalized[key.toLowerCase().replace(normalizeKeyRegex, "")] = row[key];
  }

  const getString = (key: string) => {
    const normalizedKey = key.toLowerCase().replace(normalizeKeyRegex, "");
    const val = String(rowNormalized[normalizedKey] ?? row[key] ?? "").trim();
    return val === "-" ? "" : val;
  };

  const getNumber = (key: string) => {
    const normalizedKey = key.toLowerCase().replace(normalizeKeyRegex, "");
    const val = rowNormalized[normalizedKey] ?? row[key];
    if (typeof val === "number") return val;
    const strVal = String(val ?? "0").replace(commaRegex, "");
    return strVal === "-" ? 0 : parseFloat(strVal) || 0;
  };

  // Filter: only include EXEC actions
  const action = getString("Action").toUpperCase();
  if (action !== "EXEC") return null;

  // Filter: must have fill_type
  const fillType = getString("FillType");
  if (!fillType) return null;

  const clientCode = getString("ClientCode");
  const securityCode = getString("SecurityCode");
  if (!clientCode || !securityCode) return null;

  const sideRaw = getString("Side").toUpperCase();
  const side: "BUY" | "SELL" = sideRaw === "S" ? "SELL" : "BUY";

  const quantity = getNumber("Quantity");
  const price = getNumber("Price");
  const value = getNumber("Value") || quantity * price;

  // Parse date - DSE uses various formats
  const dateRaw = getString("Date");
  let tradeDate = dateRaw;

  // Handle DD/MM/YYYY format
  if (dateRaw.includes("/")) {
    const parts = dateRaw.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      tradeDate = `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
    }
  }
  // Handle DDMMYYYY format
  else if (dateRaw.length === 8 && !dateRaw.includes("-")) {
    const day = dateRaw.substring(0, 2);
    const month = dateRaw.substring(2, 4);
    const year = dateRaw.substring(4, 8);
    tradeDate = `${year}${month}${day}`;
  }
  // Handle YYYY-MM-DD format
  else if (dateRaw.includes("-")) {
    tradeDate = dateRaw.replace(/-/g, "");
  }

  const tradeTime = getString("Time");
  const execIdRaw = getString("ExecID");
  const board = getString("Board");
  const category = getString("Category");

  // Generate unique exec_id
  const execId =
    execIdRaw ||
    `DSE_${clientCode}_${securityCode}_${tradeDate}_${tradeTime}_${quantity}_${price}`.replace(
      /[^a-zA-Z0-9_]/g,
      ""
    );

  return {
    cse_terminal: board || "DSE",
    dp_code: "",
    investor_code: clientCode,
    full_investor_code: clientCode,
    security_code: securityCode.toUpperCase(),
    side,
    quantity,
    price,
    value,
    trade_date: tradeDate,
    trade_time: tradeTime,
    settlement_date: tradeDate,
    settlement_time: "",
    category_flag: category || "N",
    exec_id: execId,
    file_name: fileName,
  };
}

export function TradeImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: TradeImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    imported: number;
    errors: number;
  } | null>(null);

  const resetState = useCallback(() => {
    setStep("upload");
    setFile(null);
    setParsedTrades([]);
    setValidationErrors([]);
    setImporting(false);
    setProgress(0);
    setImportSummary(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const fileNameLower = selectedFile.name.toLowerCase();
    const isTxt = fileNameLower.endsWith(".txt");
    const isXml = fileNameLower.endsWith(".xml");

    if (!isTxt && !isXml) {
      toast.error("Invalid file type", {
        description: "Please upload a .txt (CSE) or .xml (DSE) trade file",
      });
      return;
    }

    setFile(selectedFile);
    await parseFile(selectedFile);
  };

  const parseFile = async (file: File) => {
    try {
      const content = await file.text();
      const fileNameLower = file.name.toLowerCase();
      const isXml = fileNameLower.endsWith(".xml");
      const fileName = file.name;

      if (isXml) {
        // DSE XML parser
        const { trades, errors } = parseDseXmlContent(content, fileName);
        setParsedTrades(trades);
        setValidationErrors(errors);
        setStep("preview");

        if (trades.length === 0 && errors.length > 0) {
          toast.error("No valid trades found", {
            description: `${errors.length} validation errors detected`,
          });
        } else {
          toast.success(`Parsed ${trades.length} DSE trades`, {
            description: errors.length > 0 ? `${errors.length} lines with errors` : undefined,
          });
        }
      } else {
        // CSE pipe-delimited parser
        const lines = content.split("\n").filter((line) => line.trim());

        if (lines.length === 0) {
          toast.error("Empty file", { description: "The file contains no data" });
          return;
        }

        const trades: ParsedTrade[] = [];
        const errors: ValidationError[] = [];

        // Process each line using pipe-delimited parser
        for (let i = 0; i < lines.length; i++) {
          const result = parsePipeDelimitedLine(lines[i], i + 1, fileName);

          if ("message" in result) {
            // It's an error
            if (errors.length < 50) {
              errors.push(result);
            }
          } else {
            // It's a valid trade
            trades.push(result);
          }

          // Yield to UI periodically for large files
          if (i % 5000 === 0 && i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        setParsedTrades(trades);
        setValidationErrors(errors);
        setStep("preview");

        if (trades.length === 0 && errors.length > 0) {
          toast.error("No valid trades found", {
            description: `${errors.length} validation errors detected`,
          });
        } else {
          toast.success(`Parsed ${trades.length} CSE trades`, {
            description: errors.length > 0 ? `${errors.length} lines with errors` : undefined,
          });
        }
      }
    } catch (error: any) {
      toast.error("Failed to parse file", { description: error.message });
    }
  };

  const handleImport = async () => {
    if (parsedTrades.length === 0) {
      toast.error("No trades to import");
      return;
    }

    setImporting(true);
    setStep("importing");
    setProgress(0);

    try {
      // Fetch investor/client data for denormalization
      const clientCodes = [...new Set(parsedTrades.map((t) => t.full_investor_code))];

      const [investorsResult, clientsResult, agentCodesResult] = await Promise.all([
        supabase
          .from("investors")
          .select("investor_code, brokerage_commission, interest_rate, account_type, investor_type")
          .in("investor_code", clientCodes),
        supabase
          .from("clients")
          .select("inv_code, ledger_balance, rm_name")
          .in("inv_code", clientCodes),
        supabase
          .from("agent_codes")
          .select("investor_code, agent_id, rm_id")
          .in("investor_code", clientCodes),
      ]);

      // Build lookup maps
      const investorMap: Record<string, any> = {};
      const clientMap: Record<string, any> = {};
      const agentMap: Record<string, any> = {};

      investorsResult.data?.forEach((inv) => {
        investorMap[inv.investor_code] = inv;
      });

      clientsResult.data?.forEach((client) => {
        clientMap[client.inv_code] = client;
      });

      agentCodesResult.data?.forEach((ac) => {
        agentMap[ac.investor_code] = ac;
      });

      // Get department info
      const rmNames = [...new Set(clientsResult.data?.map((c) => c.rm_name).filter(Boolean) || [])];
      const departmentMap: Record<string, string> = {};

      if (rmNames.length > 0) {
        const { data: employees } = await supabase
          .from("employees")
          .select("name, department")
          .in("name", rmNames);

        employees?.forEach((emp) => {
          if (emp.name) departmentMap[emp.name] = emp.department;
        });
      }

      // Prepare records for insert
      const records = parsedTrades.map((trade) => {
        const investorData = investorMap[trade.full_investor_code];
        const clientData = clientMap[trade.full_investor_code];
        const agentData = agentMap[trade.full_investor_code];
        const rmName = clientData?.rm_name || null;
        const department = rmName ? departmentMap[rmName] || null : null;

        return {
          action: "EXEC",
          status: "FILL",
          side: trade.side,
          security_code: sanitizeString(trade.security_code),
          board: trade.cse_terminal,
          trade_date: trade.trade_date,
          trade_time: trade.trade_time,
          quantity: trade.quantity,
          price: trade.price,
          value: trade.value,
          client_code: trade.full_investor_code,
          category: trade.category_flag,
          fill_type: "FILL",
          exec_id: trade.exec_id,
          file_name: trade.file_name,
          // Denormalized data
          brokerage_commission: investorData?.brokerage_commission ?? null,
          interest_rate: investorData?.interest_rate ?? null,
          account_type: investorData?.account_type ?? null,
          investor_type: investorData?.investor_type ?? null,
          ledger_balance_snapshot: clientData?.ledger_balance ?? null,
          agent_id: agentData?.agent_id ?? null,
          rm_id: agentData?.rm_id ?? null,
          rm_name: rmName,
          department,
        };
      });

      // Insert in batches
      const batchSize = 1000;
      let imported = 0;
      let errorCount = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        const { error } = await supabase.from("trade_history").upsert(batch, {
          onConflict: "exec_id,trade_date,client_code,board",
          ignoreDuplicates: false,
        });

        if (error) {
          console.error("Batch insert error:", error);
          errorCount += batch.length;
        } else {
          imported += batch.length;
        }

        setProgress(Math.round(((i + batch.length) / records.length) * 100));

        // Yield to UI
        if (i % 3000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      setImportSummary({
        total: parsedTrades.length,
        imported,
        errors: errorCount + validationErrors.length,
      });
      setStep("complete");

      toast.success("Import complete", {
        description: `${imported} trades imported successfully`,
      });

      onImportComplete?.();
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error("Import failed", { description: error.message });
      setStep("preview");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Trade Data</DialogTitle>
          <DialogDescription>
            Upload a CSE (.txt) or DSE (.xml) trade file
          </DialogDescription>
        </DialogHeader>

        {/* Step: Upload */}
        {step === "upload" && (
          <div className="space-y-6">
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Click to upload or drag and drop</p>
              <p className="text-sm text-muted-foreground mt-2">
                CSE (.txt) or DSE (.xml) trade files
              </p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".txt,.xml"
                className="hidden"
              />
            </div>

            <div className="bg-muted/50 rounded-lg p-4 space-y-4">
              <div>
                <h4 className="font-medium mb-2">CSE Format (.txt - Pipe-Delimited)</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Each line contains trade data with pipe (|) separators:
                </p>
                <code className="text-xs block bg-background p-2 rounded font-mono break-all">
                  DHK01|14028|LOVELLO|S|35000|65.00|GZ44|||22|13/01/2026|10:11:38|13/01/2026|10:11:38|B
                </code>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground">
                  <div>• Field 1: CSE Terminal (DHK01)</div>
                  <div>• Field 3: Security Code</div>
                  <div>• Field 4: Side (B/S)</div>
                  <div>• Field 5-6: Qty, Price</div>
                  <div>• Field 7: Investor Code</div>
                  <div>• Field 11: Trade Date</div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">DSE Format (.xml - Excel/Detail)</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Excel-style XML with Row/Cell elements or Detail attributes:
                </p>
                <code className="text-xs block bg-background p-2 rounded font-mono break-all">
                  &lt;Detail Action="EXEC" ClientCode="12345" SecurityCode="STOCK" Side="B" Quantity="100" Price="50.00" FillType="FILL" /&gt;
                </code>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground">
                  <div>• Action: Must be "EXEC"</div>
                  <div>• FillType: Must have value</div>
                  <div>• ClientCode: Investor ID</div>
                  <div>• SecurityCode, Side, Qty, Price</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">{file?.name}</p>
                <p className="text-sm text-muted-foreground">
                  {parsedTrades.length.toLocaleString()} trades parsed
                  {validationErrors.length > 0 && (
                    <span className="text-destructive ml-2">
                      ({validationErrors.length} errors)
                    </span>
                  )}
                </p>
              </div>
            </div>

            {validationErrors.length > 0 && (
              <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="font-medium text-destructive">Validation Errors</span>
                </div>
                <ScrollArea className="h-24">
                  {validationErrors.slice(0, 15).map((err, idx) => (
                    <p key={idx} className="text-sm text-muted-foreground font-mono">
                      Line {err.line}: {err.message}
                      {err.raw && <span className="text-xs ml-2 opacity-60">[{err.raw}...]</span>}
                    </p>
                  ))}
                  {validationErrors.length > 15 && (
                    <p className="text-sm text-muted-foreground italic">
                      ...and {validationErrors.length - 15} more errors
                    </p>
                  )}
                </ScrollArea>
              </div>
            )}

            <div className="border rounded-lg">
              <ScrollArea className="h-[350px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[70px]">Terminal</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Security</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Trade Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Cat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedTrades.slice(0, 100).map((trade, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">
                          {trade.cse_terminal}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {trade.full_investor_code}
                        </TableCell>
                        <TableCell className="font-medium">
                          {trade.security_code}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={trade.side === "BUY" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {trade.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {trade.quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {trade.price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {trade.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatDateForDisplay(trade.trade_date)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatTimeForDisplay(trade.trade_time)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">
                            {trade.category_flag}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {parsedTrades.length > 100 && (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="text-center text-muted-foreground italic"
                        >
                          ...and {(parsedTrades.length - 100).toLocaleString()} more trades
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-muted-foreground">Total Qty</p>
                <p className="font-bold">{parsedTrades.reduce((sum, t) => sum + t.quantity, 0).toLocaleString()}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-muted-foreground">Total Value</p>
                <p className="font-bold">৳{parsedTrades.reduce((sum, t) => sum + t.value, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-3">
                <p className="text-muted-foreground">Buy Trades</p>
                <p className="font-bold text-green-600">{parsedTrades.filter(t => t.side === "BUY").length.toLocaleString()}</p>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3">
                <p className="text-muted-foreground">Sell Trades</p>
                <p className="font-bold text-red-600">{parsedTrades.filter(t => t.side === "SELL").length.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Step: Importing */}
        {step === "importing" && (
          <div className="space-y-6 py-8">
            <div className="text-center">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-lg font-medium">Importing trades...</p>
              <p className="text-sm text-muted-foreground">
                Please wait, this may take a moment for large files
              </p>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-center text-sm text-muted-foreground">
              {progress}% complete
            </p>
          </div>
        )}

        {/* Step: Complete */}
        {step === "complete" && importSummary && (
          <div className="space-y-6 py-8">
            <div className="text-center">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <p className="text-lg font-medium">Import Complete</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{importSummary.total.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total Records</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {importSummary.imported.toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              <div className="bg-destructive/10 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-destructive">
                  {importSummary.errors}
                </p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" onClick={resetState}>
                Upload Different File
              </Button>
              <Button
                onClick={handleImport}
                disabled={parsedTrades.length === 0 || importing}
              >
                Import {parsedTrades.length.toLocaleString()} Trades
              </Button>
            </>
          )}

          {step === "importing" && (
            <Button variant="outline" disabled>
              Importing...
            </Button>
          )}

          {step === "complete" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
