import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Percent, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn, formatDateToISO, normalizeToLocalDate } from "@/lib/utils";
import * as XLSX from "xlsx";

interface ImportCommissionsDialogProps {
  onSuccess?: () => void;
}

interface ParsedRecord {
  code: string;
  commission: number;
}

export function ImportCommissionsDialog({ onSuccess }: ImportCommissionsDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRecord[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [cutoffDate, setCutoffDate] = useState<Date>(new Date());
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ updated: number; notFound: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setProgress(0);
    setResults(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (isImporting) return;
    setOpen(newOpen);
    if (!newOpen) {
      resetState();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseError(null);
    setResults(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true });

        const records: ParsedRecord[] = [];
        const errors: string[] = [];

        jsonData.forEach((row: any, idx: number) => {
          // Try different column names for code
          const code = row["code"] || row["Code"] || row["investor_code"] || row["Investor Code"];
          // Try different column names for commission
          const commission = row["brokerage_commission"] || row["Brokerage Commission"] || 
                            row["commission"] || row["Commission"] || row["Brokerage_Commission"];

          if (!code) {
            errors.push(`Row ${idx + 2}: Missing code`);
            return;
          }

          const commissionValue = parseFloat(commission);
          if (isNaN(commissionValue)) {
            errors.push(`Row ${idx + 2}: Invalid commission value`);
            return;
          }

          records.push({
            code: String(code).trim(),
            commission: commissionValue / 100, // Convert 0.4 → 0.004
          });
        });

        if (errors.length > 0 && errors.length > 10) {
          setParseError(`Found ${errors.length} errors. First few: ${errors.slice(0, 3).join(", ")}`);
        } else if (errors.length > 0) {
          setParseError(errors.join(", "));
        }

        setParsedData(records);
      } catch (error) {
        console.error("Parse error:", error);
        setParseError("Failed to parse file. Please ensure it's a valid Excel/CSV file.");
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;

    setIsImporting(true);
    setProgress(0);

    const batchSize = 100;
    let updated = 0;
    const notFound: string[] = [];
    const cutoffDateStr = formatDateToISO(cutoffDate);

    try {
      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize);
        
        // Update each record in the batch
        for (const record of batch) {
          const { data, error } = await supabase
            .from("investors")
            .update({ 
              brokerage_commission: record.commission,
              updated_at: cutoffDateStr
            })
            .eq("investor_code", record.code)
            .select("investor_code");

          if (error) {
            console.error(`Error updating ${record.code}:`, error);
          } else if (data && data.length > 0) {
            updated++;
          } else {
            notFound.push(record.code);
          }
        }

        setProgress(Math.round(((i + batch.length) / parsedData.length) * 100));
      }

      setResults({ updated, notFound });
      
      if (updated > 0) {
        toast.success(`Updated ${updated} commissions with cutoff date ${cutoffDateStr}`);
        onSuccess?.();
      }
      
      if (notFound.length > 0) {
        toast.warning(`${notFound.length} codes not found in database`);
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Percent className="mr-2 h-4 w-4" />
          Update Commissions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            Bulk Update Commissions
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cutoff Date Picker */}
          <div className="space-y-2">
            <Label>Cutoff Date (Effective Date)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !cutoffDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {cutoffDate ? format(cutoffDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={cutoffDate}
                onSelect={(date) => date && setCutoffDate(normalizeToLocalDate(date))}
                initialFocus
                className="pointer-events-auto"
              />
              </PopoverContent>
            </Popover>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Commission File (CSV/Excel)</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
              {file ? (
                <p className="text-sm">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click to upload CSV or Excel file
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Expected columns: code, brokerage_commission (e.g., 0.4 = 0.4%)
            </p>
          </div>

          {/* Parse Error */}
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Parsed Summary */}
          {parsedData.length > 0 && !results && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 text-primary text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Ready to update {parsedData.length.toLocaleString()} commission rates</span>
            </div>
          )}

          {/* Progress */}
          {isImporting && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Updating... {progress}%
              </p>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="space-y-2 p-3 rounded-lg bg-muted">
              <p className="text-sm font-medium">Import Complete</p>
              <p className="text-sm text-green-600">✓ Updated: {results.updated.toLocaleString()}</p>
              {results.notFound.length > 0 && (
                <p className="text-sm text-amber-600">
                  ⚠ Not found: {results.notFound.length.toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isImporting}>
              {results ? "Close" : "Cancel"}
            </Button>
            {!results && (
              <Button 
                onClick={handleImport} 
                disabled={parsedData.length === 0 || isImporting}
              >
                <Upload className="mr-2 h-4 w-4" />
                Update {parsedData.length.toLocaleString()} Records
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
