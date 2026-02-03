import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle } from "lucide-react";
import { format } from "date-fns";

interface MarginListImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: Date | null;
  onImportComplete?: () => void;
}

interface ParsedRecord {
  ticker: string;
  close_price: number;
  remarks: string | null;
  is_marginable: boolean;
}

export function MarginListImportDialog({
  open,
  onOpenChange,
  selectedDate,
  onImportComplete,
}: MarginListImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [parseResult, setParseResult] = useState<{
    records: ParsedRecord[];
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseResult(null);

    // Parse the file immediately to show preview
    try {
      const records = await parseExcelFile(selectedFile);
      setParseResult(records);
    } catch (error) {
      toast.error("Failed to parse file: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const parseExcelFile = async (file: File): Promise<{ records: ParsedRecord[]; errors: string[] }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Convert to JSON, skip header row
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
          
          const records: ParsedRecord[] = [];
          const errors: string[] = [];

          // Start from row 2 (index 1) to skip header
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            // Column B (index 1) = Ticker
            // Column D (index 3) = Close Price
            // Column F (index 5) = Remarks
            const ticker = row[1]?.toString().trim();
            const closePrice = parseFloat(row[3]?.toString() || "0");
            const remarks = row[5]?.toString().trim() || null;

            if (!ticker) {
              if (row.some(cell => cell)) {
                errors.push(`Row ${i + 1}: Missing ticker`);
              }
              continue;
            }

            if (isNaN(closePrice) || closePrice < 0) {
              errors.push(`Row ${i + 1}: Invalid close price for ${ticker}`);
              continue;
            }

            // Securities WITHOUT a Remark are MARGINABLE
            const isMarginable = !remarks || remarks.length === 0;

            records.push({
              ticker,
              close_price: closePrice,
              remarks,
              is_marginable: isMarginable,
            });
          }

          resolve({ records, errors: errors.slice(0, 10) }); // Limit errors shown
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.records.length === 0) {
      toast.error("No valid records to import");
      return;
    }

    if (!selectedDate) {
      toast.error("Please select a date first");
      return;
    }

    setIsUploading(true);
    const priceDate = format(selectedDate, "yyyy-MM-dd");

    try {
      // Delete existing records for this date first
      const { error: deleteError } = await supabase
        .from("securities_margin_prices")
        .delete()
        .eq("price_date", priceDate);

      if (deleteError) throw deleteError;

      // Insert in batches
      const batchSize = 100;
      let inserted = 0;

      for (let i = 0; i < parseResult.records.length; i += batchSize) {
        const batch = parseResult.records.slice(i, i + batchSize).map((r) => ({
          ticker: r.ticker,
          close_price: r.close_price,
          remarks: r.remarks,
          is_marginable: r.is_marginable,
          price_date: priceDate,
        }));

        const { error } = await supabase
          .from("securities_margin_prices")
          .upsert(batch, { onConflict: "ticker,price_date" });

        if (error) throw error;
        inserted += batch.length;
      }

      toast.success(`Imported ${inserted} securities for ${priceDate}`);
      onImportComplete?.();
      handleClose();
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setParseResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  const marginableCount = parseResult?.records.filter((r) => r.is_marginable).length || 0;
  const nonMarginableCount = parseResult?.records.filter((r) => !r.is_marginable).length || 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Margin List & Prices
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file with securities data. Format: Sl., Ticker, Trailing PE, Close Price, Sector, Remarks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {selectedDate && (
            <div className="text-sm text-muted-foreground">
              Importing for date: <span className="font-medium">{format(selectedDate, "dd MMM yyyy")}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="file">Excel File (.xlsx, .xls)</Label>
            <Input
              id="file"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              ref={fileInputRef}
              disabled={isUploading}
            />
          </div>

          {parseResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>{parseResult.records.length} records parsed</span>
                </div>
                <div className="text-muted-foreground">
                  {marginableCount} marginable, {nonMarginableCount} non-marginable
                </div>
              </div>

              {parseResult.errors.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {parseResult.errors.length} parsing errors
                  </div>
                  <ul className="mt-2 text-xs text-destructive/80 space-y-1">
                    {parseResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {parseResult.records.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Ticker</th>
                        <th className="px-2 py-1.5 text-right font-medium">Close Price</th>
                        <th className="px-2 py-1.5 text-left font-medium">Remarks</th>
                        <th className="px-2 py-1.5 text-center font-medium">Marginable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parseResult.records.slice(0, 20).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1">{r.ticker}</td>
                          <td className="px-2 py-1 text-right">{r.close_price.toFixed(2)}</td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[120px]">
                            {r.remarks || "-"}
                          </td>
                          <td className="px-2 py-1 text-center">
                            {r.is_marginable ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-red-500">✗</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parseResult.records.length > 20 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/30">
                      ... and {parseResult.records.length - 20} more records
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={isUploading || !parseResult || parseResult.records.length === 0 || !selectedDate}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Import {parseResult?.records.length || 0} Records
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
