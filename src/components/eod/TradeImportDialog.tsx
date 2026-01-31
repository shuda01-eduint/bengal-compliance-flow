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
import { format } from "date-fns";
import { sanitizeString } from "@/lib/validation-schemas";

interface ParsedTrade {
  trade_date: string;
  client_code: string;
  security_code: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  value: number;
  commission: number;
  settlement_date: string;
  category: string;
  exec_id: string;
  file_name: string;
}

interface ValidationError {
  line: number;
  message: string;
}

interface TradeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "complete";

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
        description: "Please upload a .txt file with pipe-delimited data",
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
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split("|");

        // Expected format: Trade Date|Investor Code|Instrument Code|Buy/Sell|Quantity|Price|Trade Value|Commission|Settlement Date|Category
        if (parts.length < 10) {
          if (errors.length < 20) {
            errors.push({
              line: i + 1,
              message: `Invalid format: expected 10 columns, got ${parts.length}`,
            });
          }
          continue;
        }

        const [
          tradeDateRaw,
          clientCode,
          securityCode,
          sideRaw,
          quantityRaw,
          priceRaw,
          valueRaw,
          commissionRaw,
          settlementDateRaw,
          categoryRaw,
        ] = parts;

        // Validate required fields
        if (!tradeDateRaw?.trim() || !clientCode?.trim() || !securityCode?.trim()) {
          if (errors.length < 20) {
            errors.push({
              line: i + 1,
              message: "Missing required fields: Trade Date, Investor Code, or Instrument Code",
            });
          }
          continue;
        }

        // Parse numeric values
        const quantity = parseInt(quantityRaw?.replace(/,/g, "") || "0", 10);
        const price = parseFloat(priceRaw?.replace(/,/g, "") || "0");
        const value = parseFloat(valueRaw?.replace(/,/g, "") || "0") || quantity * price;
        const commission = parseFloat(commissionRaw?.replace(/,/g, "") || "0");

        if (isNaN(quantity) || quantity <= 0) {
          if (errors.length < 20) {
            errors.push({ line: i + 1, message: "Invalid quantity" });
          }
          continue;
        }

        if (isNaN(price) || price <= 0) {
          if (errors.length < 20) {
            errors.push({ line: i + 1, message: "Invalid price" });
          }
          continue;
        }

        // Parse side (B/S or BUY/SELL)
        const sideUpper = sideRaw?.trim().toUpperCase() || "";
        const side: "BUY" | "SELL" =
          sideUpper === "S" || sideUpper === "SELL" ? "SELL" : "BUY";

        // Format dates (handle yyyy-mm-dd format)
        let tradeDate = tradeDateRaw.trim();
        let settlementDate = settlementDateRaw?.trim() || "";

        // Convert date format to YYYYMMDD if needed
        if (tradeDate.includes("-")) {
          tradeDate = tradeDate.replace(/-/g, "");
        }
        if (settlementDate.includes("-")) {
          settlementDate = settlementDate.replace(/-/g, "");
        }

        // Generate exec_id for deduplication
        const execId = `${tradeDate}_${clientCode.trim()}_${securityCode.trim()}_${side}_${quantity}_${price}_${i}`;

        trades.push({
          trade_date: tradeDate,
          client_code: sanitizeString(clientCode.trim()),
          security_code: sanitizeString(securityCode.trim()),
          side,
          quantity,
          price,
          value,
          commission,
          settlement_date: settlementDate,
          category: sanitizeString(categoryRaw?.trim() || ""),
          exec_id: execId,
          file_name: fileName,
        });
      }

      setParsedTrades(trades);
      setValidationErrors(errors);
      setStep("preview");

      if (trades.length === 0 && errors.length > 0) {
        toast.error("No valid trades found", {
          description: `${errors.length} validation errors detected`,
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
      const clientCodes = [...new Set(parsedTrades.map((t) => t.client_code))];

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
        const investorData = investorMap[trade.client_code];
        const clientData = clientMap[trade.client_code];
        const agentData = agentMap[trade.client_code];
        const rmName = clientData?.rm_name || null;
        const department = rmName ? departmentMap[rmName] || null : null;

        return {
          action: "EXEC",
          status: "FILL",
          side: trade.side,
          security_code: trade.security_code,
          trade_date: trade.trade_date,
          quantity: trade.quantity,
          price: trade.price,
          value: trade.value,
          client_code: trade.client_code,
          category: trade.category,
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
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Trade Data</DialogTitle>
          <DialogDescription>
            Upload a pipe-delimited .txt file with trade data
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
                Pipe-delimited .txt file
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
              <h4 className="font-medium mb-2">Expected Format</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Each line should have 10 pipe-delimited columns:
              </p>
              <code className="text-xs block bg-background p-2 rounded">
                Trade Date|Investor Code|Instrument|Side|Qty|Price|Value|Commission|Settlement Date|Category
              </code>
              <code className="text-xs block bg-background p-2 rounded mt-1 text-muted-foreground">
                2026-01-13|INV001|BRAC|B|100|45.50|4550.00|22.75|2026-01-15|A
              </code>
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
                  {parsedTrades.length} trades parsed
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
                  {validationErrors.slice(0, 10).map((err, idx) => (
                    <p key={idx} className="text-sm text-muted-foreground">
                      Line {err.line}: {err.message}
                    </p>
                  ))}
                  {validationErrors.length > 10 && (
                    <p className="text-sm text-muted-foreground italic">
                      ...and {validationErrors.length - 10} more errors
                    </p>
                  )}
                </ScrollArea>
              </div>
            )}

            <div className="border rounded-lg">
              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Security</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedTrades.slice(0, 100).map((trade, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">
                          {trade.trade_date}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {trade.client_code}
                        </TableCell>
                        <TableCell>{trade.security_code}</TableCell>
                        <TableCell>
                          <Badge
                            variant={trade.side === "BUY" ? "default" : "secondary"}
                          >
                            {trade.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.value.toLocaleString()}
                        </TableCell>
                        <TableCell>{trade.category}</TableCell>
                      </TableRow>
                    ))}
                    {parsedTrades.length > 100 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center text-muted-foreground italic"
                        >
                          ...and {parsedTrades.length - 100} more trades
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
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
                <p className="text-2xl font-bold">{importSummary.total}</p>
                <p className="text-sm text-muted-foreground">Total Records</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {importSummary.imported}
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
                Import {parsedTrades.length} Trades
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
