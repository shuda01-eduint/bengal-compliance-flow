import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

interface ClientRecord {
  inv_code: string;
  investor_name: string;
  ledger_balance: number;
  accrued_interest: number;
  current_liabilities: number;
  market_value: number;
  equity: number;
  rm_name: string;
  status: string;
}

interface ImportClientsDialogProps {
  onImportComplete: () => void;
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
    // Remove commas and parse
    const cleaned = String(value).replace(/,/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setStatus("reading");
    setProgress(0);
    setResult(null);

    try {
      // Read Excel file
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

      // Parse rows (skip header)
      const clients: ClientRecord[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as (string | number | undefined)[];
        if (!row || row.length < 10) continue;
        
        const invCode = String(row[1] || "").trim();
        const investorName = String(row[2] || "").trim();
        const rmName = String(row[8] || "General").trim();
        const status = String(row[9] || "Active").trim();

        if (!invCode || !investorName) continue;

        clients.push({
          inv_code: invCode,
          investor_name: investorName,
          ledger_balance: parseNumber(row[3]),
          accrued_interest: parseNumber(row[4]),
          current_liabilities: parseNumber(row[5]),
          market_value: parseNumber(row[6]),
          equity: parseNumber(row[7]),
          rm_name: rmName || "General",
          status: status || "Active",
        });
      }

      console.log(`Parsed ${clients.length} clients from Excel`);
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
            clearExisting: i === 0 // Only clear on first batch
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

  const handleClose = () => {
    if (!importing) {
      setOpen(false);
      setStatus("idle");
      setProgress(0);
      setResult(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" />
          Import Excel
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
                Upload an Excel file (.xlsx) with client balance data.
                The file should have columns: Inv. Code, Investor Name, Ledger Balance, etc.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
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
              <Button onClick={handleClose} className="w-full">
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
              <Button onClick={handleClose} variant="outline" className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
