import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Upload, CalendarIcon, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ParsedBalance {
  investor_code: string;
  ledger_balance: number;
  investor_name?: string;
}

export const ImportOpeningBalancesDialog = ({ onSuccess }: { onSuccess?: () => void }) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedBalance[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [balanceDate, setBalanceDate] = useState<Date | undefined>();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ imported: number; errors: number } | null>(null);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setBalanceDate(undefined);
    setIsImporting(false);
    setProgress(0);
    setResults(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    setOpen(newOpen);
  };

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseError(null);
    setParsedData([]);
    setResults(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        if (jsonData.length === 0) {
          setParseError("File is empty or has no data rows");
          return;
        }

        const parsed: ParsedBalance[] = [];
        const errors: string[] = [];

        jsonData.forEach((row, index) => {
          // Try multiple possible column names for investor code
          const investorCode = String(
            row["investor_code"] || row["Investor Code"] || row["inv_code"] || 
            row["Code"] || row["code"] || row["CLIENT CODE"] || row["client_code"] || ""
          ).trim();

          // Try multiple possible column names for ledger balance
          const balanceRaw = row["ledger_balance"] || row["Ledger Balance"] || 
            row["balance"] || row["Balance"] || row["LEDGER BALANCE"] || 
            row["opening_balance"] || row["Opening Balance"] || 0;

          // Try to get investor name if available
          const investorName = String(
            row["investor_name"] || row["Investor Name"] || row["name"] || 
            row["Name"] || row["CLIENT NAME"] || ""
          ).trim() || undefined;

          if (!investorCode) {
            errors.push(`Row ${index + 2}: Missing investor code`);
            return;
          }

          const balance = typeof balanceRaw === "number" 
            ? balanceRaw 
            : parseFloat(String(balanceRaw).replace(/,/g, ""));

          if (isNaN(balance)) {
            errors.push(`Row ${index + 2}: Invalid balance value for ${investorCode}`);
            return;
          }

          parsed.push({
            investor_code: investorCode,
            ledger_balance: balance,
            investor_name: investorName,
          });
        });

        if (errors.length > 0 && parsed.length === 0) {
          setParseError(errors.slice(0, 5).join("\n"));
          return;
        }

        if (errors.length > 0) {
          toast.warning(`${errors.length} rows skipped due to errors`);
        }

        setParsedData(parsed);
        toast.success(`Parsed ${parsed.length} balance records`);
      } catch (error) {
        console.error("Parse error:", error);
        setParseError("Failed to parse file. Please ensure it's a valid Excel or CSV file.");
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  }, []);

  const handleImport = async () => {
    if (!balanceDate || parsedData.length === 0) {
      toast.error("Please select a date and upload a valid file");
      return;
    }

    setIsImporting(true);
    setProgress(0);
    setResults(null);

    const dateStr = format(balanceDate, "yyyy-MM-dd");
    const batchSize = 500;
    let imported = 0;
    let errors = 0;

    try {
      // First, delete existing records for this date
      const { error: deleteError } = await supabase
        .from("eod_ledger_snapshots")
        .delete()
        .eq("eod_date", dateStr);

      if (deleteError) {
        console.error("Delete error:", deleteError);
        toast.error("Failed to clear existing records for this date");
        setIsImporting(false);
        return;
      }

      // Import in batches
      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize);
        
        const records = batch.map((item) => ({
          eod_date: dateStr,
          investor_code: item.investor_code,
          ledger_balance: item.ledger_balance,
          investor_name: item.investor_name || null,
        }));

        const { error } = await supabase
          .from("eod_ledger_snapshots")
          .insert(records);

        if (error) {
          console.error("Insert error:", error);
          errors += batch.length;
        } else {
          imported += batch.length;
        }

        setProgress(Math.round(((i + batch.length) / parsedData.length) * 100));
      }

      setResults({ imported, errors });

      if (errors === 0) {
        toast.success(`Successfully imported ${imported} opening balances for ${format(balanceDate, "MMM d, yyyy")}`);
        onSuccess?.();
      } else {
        toast.warning(`Imported ${imported} records, ${errors} failed`);
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const totalBalance = parsedData.reduce((sum, item) => sum + item.ledger_balance, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Import Opening Balances
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Opening Balances</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file with investor codes and their ledger balances for a specific date.
            This will be used as the opening balance for EOD calculations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date Picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Balance As Of Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !balanceDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {balanceDate ? format(balanceDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={balanceDate}
                  onSelect={setBalanceDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              This is the closing date for these balances. They will be used as opening balances for the next day.
            </p>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Upload File</label>
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary/50 hover:bg-muted/50",
                file && "border-primary bg-primary/5"
              )}
              onClick={() => document.getElementById("balance-file-input")?.click()}
            >
              <input
                id="balance-file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click or drag to upload Excel/CSV file
                </p>
              )}
            </div>
          </div>

          {/* Expected Columns */}
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p className="font-medium mb-1">Expected columns:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><code>investor_code</code> or <code>Investor Code</code> (required)</li>
              <li><code>ledger_balance</code> or <code>Ledger Balance</code> (required)</li>
              <li><code>investor_name</code> or <code>Investor Name</code> (optional)</li>
            </ul>
          </div>

          {/* Parse Error */}
          {parseError && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <pre className="whitespace-pre-wrap">{parseError}</pre>
            </div>
          )}

          {/* Parsed Data Preview */}
          {parsedData.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">
                  Preview ({parsedData.length} records)
                </span>
                <span className="text-sm text-muted-foreground">
                  Total: {totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="border rounded-md max-h-48 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Investor Code</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-right p-2 font-medium">Ledger Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 50).map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2 font-mono text-xs">{item.investor_code}</td>
                        <td className="p-2 text-xs truncate max-w-[150px]">
                          {item.investor_name || "-"}
                        </td>
                        <td className={cn(
                          "p-2 text-right font-mono text-xs",
                          item.ledger_balance < 0 && "text-destructive"
                        )}>
                          {item.ledger_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground bg-muted">
                    ... and {parsedData.length - 50} more records
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Progress */}
          {isImporting && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-center text-muted-foreground">
                Importing... {progress}%
              </p>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className={cn(
              "p-3 rounded-md text-sm",
              results.errors === 0 ? "bg-green-500/10 text-green-700" : "bg-yellow-500/10 text-yellow-700"
            )}>
              Imported {results.imported} records
              {results.errors > 0 && `, ${results.errors} failed`}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!balanceDate || parsedData.length === 0 || isImporting}
          >
            {isImporting ? "Importing..." : `Import ${parsedData.length} Records`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
