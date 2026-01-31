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
  exchange: string;
  dp_code: string;
  investor_code: string;
  full_investor_code: string;
  security_code: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  value: number;
  trade_id: string;
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

// Convert DDMMYYYY to YYYYMMDD format
function convertDateFormat(ddmmyyyy: string): string {
  if (ddmmyyyy.length !== 8) return ddmmyyyy;
  const day = ddmmyyyy.substring(0, 2);
  const month = ddmmyyyy.substring(2, 4);
  const year = ddmmyyyy.substring(4, 8);
  return `${year}${month}${day}`;
}

// Convert DDMMYYYY to YYYY-MM-DD display format
function formatDateForDisplay(ddmmyyyy: string): string {
  if (ddmmyyyy.length !== 8) return ddmmyyyy;
  const day = ddmmyyyy.substring(0, 2);
  const month = ddmmyyyy.substring(2, 4);
  const year = ddmmyyyy.substring(4, 8);
  return `${year}-${month}-${day}`;
}

// Convert HHMMSS to HH:MM:SS display format
function formatTimeForDisplay(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  const hour = hhmmss.substring(0, 2);
  const min = hhmmss.substring(2, 4);
  const sec = hhmmss.substring(4, 6);
  return `${hour}:${min}:${sec}`;
}

// Parse a single line of DSE fixed-width trade data
function parseFixedWidthLine(line: string, lineNumber: number, fileName: string): ParsedTrade | ValidationError {
  const trimmed = line.trim();
  
  // Minimum length check: 3+2+5 (fixed start) + some middle + 29 (fixed end) = ~45+ chars
  if (trimmed.length < 45) {
    return { line: lineNumber, message: `Line too short (${trimmed.length} chars, need 45+)`, raw: trimmed.substring(0, 50) };
  }

  try {
    // === FIXED START POSITIONS ===
    const exchange = trimmed.substring(0, 3); // DHK or CSE
    const dpCode = trimmed.substring(3, 5); // 01, 05, 11, 16, etc.
    const investorCode = trimmed.substring(5, 10); // 5 digits
    const fullInvestorCode = dpCode + investorCode;

    // === FIXED END POSITIONS (from the end) ===
    const len = trimmed.length;
    const categoryFlag = trimmed.substring(len - 1); // Last char: B or N
    const settlementTime = trimmed.substring(len - 7, len - 1); // 6 chars before category
    const settlementDate = trimmed.substring(len - 15, len - 7); // 8 chars DDMMYYYY
    const tradeTime = trimmed.substring(len - 21, len - 15); // 6 chars HHMMSS
    const tradeDate = trimmed.substring(len - 29, len - 21); // 8 chars DDMMYYYY

    // Validate dates look like numbers
    if (!/^\d{8}$/.test(tradeDate)) {
      return { line: lineNumber, message: `Invalid trade date format: ${tradeDate}`, raw: trimmed.substring(0, 50) };
    }
    if (!/^\d{8}$/.test(settlementDate)) {
      return { line: lineNumber, message: `Invalid settlement date format: ${settlementDate}`, raw: trimmed.substring(0, 50) };
    }

    // === VARIABLE MIDDLE SECTION ===
    // Everything between position 10 and (len - 29)
    const middleSection = trimmed.substring(10, len - 29);
    
    if (middleSection.length < 10) {
      return { line: lineNumber, message: `Middle section too short: ${middleSection}`, raw: trimmed.substring(0, 50) };
    }

    // Find the side (B or S) - it separates instrument code from quantity
    // Instrument is uppercase letters, side is B or S, followed by digits
    const sideMatch = middleSection.match(/^([A-Z0-9]+)(B|S)(.+)$/);
    if (!sideMatch) {
      return { line: lineNumber, message: `Cannot find B/S side indicator`, raw: trimmed.substring(0, 50) };
    }

    const securityCode = sideMatch[1];
    const side: "BUY" | "SELL" = sideMatch[2] === "S" ? "SELL" : "BUY";
    const afterSide = sideMatch[3]; // e.g., "3500065.00GZ44221"

    // Parse: Quantity + Price + TradeID
    // Price has a decimal point (XX.XX format)
    // TradeID starts with letters (like GZ, NJ) followed by digits

    // Find the decimal point for price
    const decimalIndex = afterSide.indexOf(".");
    if (decimalIndex === -1) {
      return { line: lineNumber, message: `Cannot find decimal point for price`, raw: trimmed.substring(0, 50) };
    }

    // After decimal, we have: 2 decimal digits + TradeID (letters + digits)
    // e.g., "00GZ44221" -> "00" is decimal part, "GZ44221" is trade ID
    const afterDecimal = afterSide.substring(decimalIndex + 1);
    
    // TradeID starts with letters (GZ, NJ, etc.) followed by digits
    const tradeIdMatch = afterDecimal.match(/^(\d{2})([A-Z]+\d+)$/);
    
    if (!tradeIdMatch) {
      return { line: lineNumber, message: `Cannot parse trade ID from: ${afterDecimal}`, raw: trimmed.substring(0, 50) };
    }

    const priceDecimals = tradeIdMatch[1]; // "00" from "65.00"
    const tradeId = tradeIdMatch[2]; // "GZ44221" (includes the prefix)

    // Find where price starts - work backwards from decimal
    let priceStartIndex = decimalIndex - 1;
    while (priceStartIndex > 0 && /\d/.test(afterSide[priceStartIndex - 1])) {
      priceStartIndex--;
    }
    
    // Quantity is everything from start of afterSide to priceStartIndex
    const quantityStr = afterSide.substring(0, priceStartIndex);
    const priceStr = afterSide.substring(priceStartIndex, decimalIndex) + "." + priceDecimals;

    const quantity = parseInt(quantityStr, 10);
    const price = parseFloat(priceStr);

    if (isNaN(quantity) || quantity <= 0) {
      return { line: lineNumber, message: `Invalid quantity: ${quantityStr}`, raw: trimmed.substring(0, 50) };
    }
    if (isNaN(price) || price <= 0) {
      return { line: lineNumber, message: `Invalid price: ${priceStr}`, raw: trimmed.substring(0, 50) };
    }

    const value = quantity * price;
    const tradeDateFormatted = convertDateFormat(tradeDate);
    const execId = `${exchange}_${fullInvestorCode}_${securityCode}_${tradeDateFormatted}_${tradeId}`;

    return {
      exchange,
      dp_code: dpCode,
      investor_code: investorCode,
      full_investor_code: fullInvestorCode,
      security_code: securityCode,
      side,
      quantity,
      price,
      value,
      trade_id: tradeId,
      trade_date: tradeDateFormatted,
      trade_time: tradeTime,
      settlement_date: convertDateFormat(settlementDate),
      settlement_time: settlementTime,
      category_flag: categoryFlag,
      exec_id: execId,
      file_name: fileName,
    };
  } catch (error: any) {
    return { line: lineNumber, message: `Parse error: ${error.message}`, raw: trimmed.substring(0, 50) };
  }
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

    if (!selectedFile.name.toLowerCase().endsWith(".txt")) {
      toast.error("Invalid file type", {
        description: "Please upload a .txt file with DSE trade data",
      });
      return;
    }

    setFile(selectedFile);
    await parseFile(selectedFile);
  };

  const parseFile = async (file: File) => {
    try {
      const content = await file.text();
      const lines = content.split("\n").filter((line) => line.trim());

      if (lines.length === 0) {
        toast.error("Empty file", { description: "The file contains no data" });
        return;
      }

      const trades: ParsedTrade[] = [];
      const errors: ValidationError[] = [];
      const fileName = file.name;

      // Process each line
      for (let i = 0; i < lines.length; i++) {
        const result = parseFixedWidthLine(lines[i], i + 1, fileName);
        
        if ('message' in result) {
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
        toast.success(`Parsed ${trades.length} trades`, {
          description: errors.length > 0 ? `${errors.length} lines with errors` : undefined,
        });
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
          board: trade.exchange,
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
          <DialogTitle>Import DSE Trade Data</DialogTitle>
          <DialogDescription>
            Upload a .txt file with DSE fixed-width trade data
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
                DSE fixed-width .txt file
              </p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".txt"
                className="hidden"
              />
            </div>

            <div className="bg-muted/50 rounded-lg p-4">
              <h4 className="font-medium mb-2">Expected Format (Fixed-Width)</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Each line contains trade data in DSE fixed-width format:
              </p>
              <code className="text-xs block bg-background p-2 rounded font-mono break-all">
                DHK0114028LOVELLOS3500065.00GZ44221301202610113813012026101138B
              </code>
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground">
                <div>• Pos 1-3: Exchange (DHK/CSE)</div>
                <div>• Pos 4-5: DP Code</div>
                <div>• Pos 6-10: Investor Code (5 digits)</div>
                <div>• Variable: Instrument Code</div>
                <div>• 1 char: Side (B=Buy, S=Sell)</div>
                <div>• Variable: Quantity</div>
                <div>• Variable: Price (with decimal)</div>
                <div>• 2 chars: Market Type (GZ, NJ)</div>
                <div>• Variable: Trade ID</div>
                <div>• 8 chars: Trade Date (DDMMYYYY)</div>
                <div>• 6 chars: Trade Time (HHMMSS)</div>
                <div>• 8 chars: Settlement Date</div>
                <div>• 6 chars: Settlement Time</div>
                <div>• 1 char: Category (B/N)</div>
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
                      <TableHead className="w-[70px]">Exchange</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Security</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Trade ID</TableHead>
                      <TableHead>Trade Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Cat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedTrades.slice(0, 100).map((trade, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">
                          {trade.exchange}
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
                          {trade.trade_id}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatDateForDisplay(trade.trade_date.replace(/(\d{4})(\d{2})(\d{2})/, "$3$2$1"))}
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
                          colSpan={11}
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
