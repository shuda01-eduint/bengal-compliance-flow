import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { sanitizeString } from "@/lib/validation-schemas";

interface ImportClientsDialogProps {
  onImportComplete: () => void;
}

interface RawBalanceRow {
  investor_code: string;
  boid: string;
  instrument: string;
  investor_name: string;
  total_stock: number;
  saleable: number;
  avg_cost: number;
  total_cost: number;
  market_value: number;
  ledger_balance: number;
  matured_balance: number;
  receivable_sales: number;
  cq_in_transit: number;
}

export function ImportClientsDialog({ onImportComplete }: ImportClientsDialogProps) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "reading" | "importing" | "complete" | "error">("idle");
  const [result, setResult] = useState<{ inserted: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const parseNumber = (value: string | number | undefined): number => {
    if (value === undefined || value === null || value === "") return 0;
    if (typeof value === "number") return value;
    const cleaned = String(value).replace(/,/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const findColumnIndex = (headers: string[], possibleNames: string[]): number => {
    const normalizedHeaders = headers.map(h => String(h || "").toLowerCase().trim().replace(/[.\s]+/g, "_"));
    for (const name of possibleNames) {
      const normalizedName = name.toLowerCase().trim().replace(/[.\s]+/g, "_");
      const index = normalizedHeaders.findIndex(h => h.includes(normalizedName) || normalizedName.includes(h));
      if (index !== -1) return index;
    }
    return -1;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setStatus("reading");
    setProgress(0);
    setResult(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

      if (jsonData.length < 2) {
        throw new Error("File is empty or has no data rows");
      }

      // Find header row and column indices
      const headers = jsonData[0] as string[];
      const colMap = {
        investor_code: findColumnIndex(headers, ["investor_code", "inv_code", "code", "investor code"]),
        boid: findColumnIndex(headers, ["boid", "bo_id", "bo id"]),
        instrument: findColumnIndex(headers, ["instrument", "trading_code", "stock"]),
        investor_name: findColumnIndex(headers, ["investor_name", "inv_name", "investor name", "name"]),
        total_stock: findColumnIndex(headers, ["totalstock", "total_stock", "total stock", "qty"]),
        saleable: findColumnIndex(headers, ["saleable", "salable"]),
        avg_cost: findColumnIndex(headers, ["avgcost", "avg_cost", "avg cost", "average cost"]),
        total_cost: findColumnIndex(headers, ["total_cost", "total cost", "totalcost"]),
        market_value: findColumnIndex(headers, ["total_m_v", "market_value", "total m.v.", "total m v", "mv", "market value"]),
        ledger_balance: findColumnIndex(headers, ["ledger_balance", "ledger balance", "ledger"]),
        matured_balance: findColumnIndex(headers, ["matured_balance", "matured balance", "matured"]),
        receivable_sales: findColumnIndex(headers, ["receivable_sales", "receivable sales", "receivable"]),
        cq_in_transit: findColumnIndex(headers, ["cq_in_transit", "cq in transit", "cq"]),
      };

      console.log("Column mapping:", colMap);

      if (colMap.investor_code === -1) {
        throw new Error("Could not find 'Investor Code' column in the file");
      }

      // Parse rows and aggregate by investor_code
      const investorMap = new Map<string, {
        investor_name: string;
        boid: string;
        ledger_balance: number;
        market_value: number;
        total_cost: number;
        total_stock: number;
        matured_balance: number;
        receivable_sales: number;
        cq_in_transit: number;
      }>();

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as (string | number | undefined)[];
        if (!row || row.length === 0) continue;

        const invCode = sanitizeString(String(row[colMap.investor_code] || "")).trim();
        if (!invCode) continue;

        const invName = colMap.investor_name !== -1 ? sanitizeString(String(row[colMap.investor_name] || "")) : "";
        const boid = colMap.boid !== -1 ? sanitizeString(String(row[colMap.boid] || "")) : "";
        const ledgerBal = colMap.ledger_balance !== -1 ? parseNumber(row[colMap.ledger_balance]) : 0;
        const marketVal = colMap.market_value !== -1 ? parseNumber(row[colMap.market_value]) : 0;
        const totalCost = colMap.total_cost !== -1 ? parseNumber(row[colMap.total_cost]) : 0;
        const totalStock = colMap.total_stock !== -1 ? parseNumber(row[colMap.total_stock]) : 0;
        const maturedBal = colMap.matured_balance !== -1 ? parseNumber(row[colMap.matured_balance]) : 0;
        const receivableSales = colMap.receivable_sales !== -1 ? parseNumber(row[colMap.receivable_sales]) : 0;
        const cqInTransit = colMap.cq_in_transit !== -1 ? parseNumber(row[colMap.cq_in_transit]) : 0;

        if (investorMap.has(invCode)) {
          const existing = investorMap.get(invCode)!;
          existing.market_value += marketVal;
          existing.total_cost += totalCost;
          existing.total_stock += totalStock;
          // Ledger balance, matured balance, receivable, CQ are account-level, take from first row
        } else {
          investorMap.set(invCode, {
            investor_name: invName,
            boid,
            ledger_balance: ledgerBal,
            market_value: marketVal,
            total_cost: totalCost,
            total_stock: totalStock,
            matured_balance: maturedBal,
            receivable_sales: receivableSales,
            cq_in_transit: cqInTransit,
          });
        }
      }

      const clients = Array.from(investorMap.entries()).map(([invCode, data]) => ({
        inv_code: invCode,
        investor_name: data.investor_name || invCode, // Use inv_code as fallback if no name
        ledger_balance: data.ledger_balance,
        market_value: data.market_value,
        equity: data.market_value + data.ledger_balance,
        accrued_interest: data.matured_balance,
        current_liabilities: data.receivable_sales + data.cq_in_transit,
        rm_name: "General",
        status: "Active",
      }));

      console.log(`Parsed ${clients.length} unique investors from Excel`);
      setProgress(10);
      setStatus("importing");

      // Send to edge function in batches
      const batchSize = 1000;
      let totalInserted = 0;
      const allErrors: string[] = [];
      const totalBatches = Math.ceil(clients.length / batchSize);

      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = clients.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        const { data, error } = await supabase.functions.invoke("import-clients", {
          body: {
            clients: batch,
            clearExisting: i === 0,
          },
        });

        if (error) {
          console.error(`Batch ${batchNum} error:`, error);
          allErrors.push(`Batch ${batchNum}: ${error.message}`);
        } else if (data) {
          totalInserted += data.inserted || 0;
          if (data.errors) {
            allErrors.push(...data.errors);
          }
        }

        setProgress(10 + (batchNum / totalBatches) * 85);
      }

      setProgress(100);
      setStatus("complete");
      setResult({ inserted: totalInserted, errors: allErrors });

      toast({
        title: "Import Complete",
        description: `Successfully imported ${totalInserted.toLocaleString()} clients`,
      });

      onImportComplete();

    } catch (error) {
      console.error("Import error:", error);
      setStatus("error");
      setResult({ inserted: 0, errors: [error instanceof Error ? error.message : "Unknown error"] });
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!importing) {
      setOpen(newOpen);
      if (!newOpen) {
        setStatus("idle");
        setProgress(0);
        setResult(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Upload className="h-4 w-4" />
          Import Balance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Client Balances</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {status === "idle" && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Upload an Excel file with columns: Investor Code, BOID, Instrument, Investor Name, TotalStock, Saleable, AvgCost, Total Cost, Total M.V., Ledger Balance, Matured Balance, Receivable sales, CQ in transit
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full gap-2"
              >
                <Upload className="h-4 w-4" />
                Select File
              </Button>
            </div>
          )}

          {(status === "reading" || status === "importing") && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                <span className="text-sm">
                  {status === "reading" ? "Reading Excel file..." : "Importing clients..."}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {progress.toFixed(0)}% complete
              </p>
            </div>
          )}

          {status === "complete" && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-success">
                <CheckCircle className="h-6 w-6" />
                <span className="font-medium">Import Complete</span>
              </div>
              <div className="glass-card rounded-lg p-4 space-y-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Records imported:</span>{" "}
                  <span className="font-medium">{result.inserted.toLocaleString()}</span>
                </p>
                {result.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {result.errors.length} error(s) occurred
                  </p>
                )}
              </div>
              <Button onClick={() => handleOpenChange(false)} className="w-full">
                Close
              </Button>
            </div>
          )}

          {status === "error" && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <span className="font-medium">Import Failed</span>
              </div>
              <div className="glass-card rounded-lg p-4">
                <p className="text-sm text-destructive">
                  {result.errors[0]}
                </p>
              </div>
              <Button onClick={() => handleOpenChange(false)} variant="outline" className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}