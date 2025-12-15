import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

interface ImportInvestorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Column mapping for flexible Excel import
const columnMappings: Record<string, string> = {
  "code no": "investor_code",
  "code": "investor_code",
  "inv. code": "investor_code",
  "investor code": "investor_code",
  "name": "investor_name",
  "investor name": "investor_name",
  "inv. name": "investor_name",
  "investor type": "investor_type",
  "type": "investor_type",
  "bo id": "bo_id",
  "boid": "bo_id",
  "bo_id": "bo_id",
  "father / spouse name": "father_spouse_name",
  "father/spouse name": "father_spouse_name",
  "father name": "father_spouse_name",
  "spouse name": "father_spouse_name",
  "mother name": "mother_name",
  "home address": "home_address",
  "address": "home_address",
  "dob": "date_of_birth",
  "date of birth": "date_of_birth",
  "cell no.": "cell_no",
  "cell no": "cell_no",
  "phone": "cell_no",
  "mobile": "cell_no",
  "email": "email",
  "e-mail": "email",
  "a/c open date": "account_open_date",
  "account open date": "account_open_date",
  "opening date": "account_open_date",
  "bank a/c no.": "bank_account_no",
  "bank a/c no": "bank_account_no",
  "bank account no": "bank_account_no",
  "bank": "bank_name",
  "bank name": "bank_name",
  "branch": "bank_branch",
  "bank branch": "bank_branch",
  "status": "status",
  "trader": "trader",
  "account type": "account_type",
  "a/c type": "account_type",
  "interest rate": "interest_rate",
  "brokerage commission": "brokerage_commission",
  "commission": "brokerage_commission",
};

function mapColumnName(col: string): string | null {
  const normalized = col.toLowerCase().trim();
  return columnMappings[normalized] || null;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  
  if (typeof value === "number") {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }
  
  if (typeof value === "string") {
    const str = value.trim();
    // Try common date formats
    const dateFormats = [
      /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
      /^(\d{2})-(\d{2})-(\d{4})$/, // DD-MM-YYYY
    ];
    
    for (const format of dateFormats) {
      const match = str.match(format);
      if (match) {
        if (format === dateFormats[0]) {
          return str;
        } else {
          return `${match[3]}-${match[2]}-${match[1]}`;
        }
      }
    }
    
    // Try parsing as date
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  }
  
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[,%]/g, ""));
  return isNaN(num) ? null : num;
}

export function ImportInvestorsDialog({ open, onOpenChange, onSuccess }: ImportInvestorsDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ success: boolean; inserted: number; errors?: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setProgress(0);
    setResult(null);

    try {
      // Read file
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      if (rawData.length < 2) {
        toast.error("File appears to be empty or has no data rows");
        setImporting(false);
        return;
      }

      // Get headers and map columns
      const headers = rawData[0] as string[];
      const columnMap: Record<number, string> = {};
      
      headers.forEach((header, idx) => {
        const mappedCol = mapColumnName(String(header));
        if (mappedCol) {
          columnMap[idx] = mappedCol;
        }
      });

      if (!Object.values(columnMap).includes("investor_code")) {
        toast.error("Could not find investor code column in file");
        setImporting(false);
        return;
      }

      // Parse records
      const records: Record<string, unknown>[] = [];
      const dataRows = rawData.slice(1);

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!row || row.every((cell) => !cell)) continue; // Skip empty rows

        const record: Record<string, unknown> = {};
        
        Object.entries(columnMap).forEach(([idxStr, field]) => {
          const idx = parseInt(idxStr);
          let value = row[idx];

          // Handle dates
          if (field === "date_of_birth" || field === "account_open_date") {
            value = parseDate(value);
          }
          // Handle numbers
          else if (field === "interest_rate" || field === "brokerage_commission") {
            value = parseNumber(value);
          }
          // Handle strings
          else if (value !== null && value !== undefined) {
            value = String(value).trim();
          }

          record[field] = value;
        });

        // Only add if has investor_code and investor_name
        if (record.investor_code && record.investor_name) {
          records.push(record);
        }

        // Update progress during parsing
        if (i % 500 === 0) {
          setProgress(Math.floor((i / dataRows.length) * 30));
          await new Promise((r) => requestAnimationFrame(r));
        }
      }

      if (records.length === 0) {
        toast.error("No valid records found in file");
        setImporting(false);
        return;
      }

      setProgress(40);

      // Send to edge function in batches
      const BATCH_SIZE = 1000;
      let totalInserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        
        const { data: funcData, error: funcError } = await supabase.functions.invoke("import-investors", {
          body: { records: batch, clearExisting: i === 0 && clearExisting },
        });

        if (funcError) {
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${funcError.message}`);
        } else if (funcData) {
          totalInserted += funcData.inserted || 0;
          if (funcData.errors) {
            errors.push(...funcData.errors);
          }
        }

        setProgress(40 + Math.floor(((i + batch.length) / records.length) * 60));
      }

      setProgress(100);
      setResult({ 
        success: totalInserted > 0, 
        inserted: totalInserted,
        errors: errors.length > 0 ? errors : undefined
      });

      if (totalInserted > 0) {
        toast.success(`Successfully imported ${totalInserted} investors`);
        onSuccess();
      } else {
        toast.error("No records were imported");
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import file");
      setResult({ success: false, inserted: 0, errors: [String(error)] });
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setFile(null);
      setResult(null);
      setProgress(0);
      setClearExisting(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Investors</DialogTitle>
          <DialogDescription>
            Upload an Excel file with investor information. Columns will be automatically mapped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload */}
          <div
            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click to select Excel file
                </p>
              </div>
            )}
          </div>

          {/* Clear existing checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="clearExisting"
              checked={clearExisting}
              onCheckedChange={(checked) => setClearExisting(checked === true)}
              disabled={importing}
            />
            <label htmlFor="clearExisting" className="text-sm text-muted-foreground">
              Clear existing data before import
            </label>
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">
                Importing... {progress}%
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`flex items-start gap-2 p-3 rounded-lg ${
              result.success ? "bg-green-500/10" : "bg-red-500/10"
            }`}>
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              )}
              <div className="text-sm">
                <p className={result.success ? "text-green-500" : "text-red-500"}>
                  {result.success
                    ? `Successfully imported ${result.inserted} investors`
                    : "Import failed"}
                </p>
                {result.errors && result.errors.length > 0 && (
                  <ul className="mt-1 text-muted-foreground text-xs">
                    {result.errors.slice(0, 3).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {result.errors.length > 3 && (
                      <li>...and {result.errors.length - 3} more errors</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={importing}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing ? "Importing..." : "Import"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
