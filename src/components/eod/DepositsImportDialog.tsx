import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import {
  DepositsWithdrawalsRecordSchema,
  validateRecords,
  type DepositsWithdrawalsRecord,
} from "@/lib/validation-schemas";
import { ImportPreviewDialog, type ImportPreviewData } from "@/components/trade-history/ImportPreviewDialog";

interface DepositsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

type ImportStep = "upload" | "analyzing" | "preview" | "importing" | "complete";

export function DepositsImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: DepositsImportDialogProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreviewData | null>(null);
  const [pendingRecords, setPendingRecords] = useState<DepositsWithdrawalsRecord[]>([]);
  const [allValidRecords, setAllValidRecords] = useState<DepositsWithdrawalsRecord[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importDates, setImportDates] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetDialog = () => {
    setStep("upload");
    setPreviewData(null);
    setPendingRecords([]);
    setAllValidRecords([]);
    setImportedCount(0);
    setReplaceExisting(false);
    setImportDates([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const parseNumber = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[,\s]/g, "");
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  // Normalize to cash_ledger_txn type enum: DEPOSIT, WITHDRAW, TRADE_CASH, COMMISSION, INTEREST, OTHER
  const normalizeTransactionType = (rawType: string): string => {
    const lower = rawType.toLowerCase().trim();
    
    if (
      lower === "receipt" ||
      lower === "receive" ||
      lower === "deposit" ||
      lower === "credit" ||
      lower.includes("receipt") ||
      lower.includes("deposit")
    ) {
      return "DEPOSIT";
    }
    
    if (
      lower === "payment" ||
      lower === "paid" ||
      lower === "withdraw" ||
      lower === "withdrawal" ||
      lower === "debit" ||
      lower.includes("payment") ||
      lower.includes("withdraw") ||
      lower.includes("paid")
    ) {
      return "WITHDRAW";
    }

    if (lower.includes("commission") || lower.includes("brokerage")) {
      return "COMMISSION";
    }

    if (lower.includes("interest")) {
      return "INTEREST";
    }
    
    return "OTHER";
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStep("analyzing");

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Look for embedded date in format "Date : DD-MMM-YYYY"
      let fileDate: string | null = null;
      const monthMap: { [key: string]: string } = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
          const cellValue = String(row[j] || '');
          const dateMatch = cellValue.match(/Date\s*:\s*(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/i);
          if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const monthStr = dateMatch[2].toLowerCase();
            const year = dateMatch[3];
            const month = monthMap[monthStr];
            if (month) {
              fileDate = `${year}-${month}-${day}`;
            }
            break;
          }
        }
        if (fileDate) break;
      }
      
      // Find the actual header row
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(15, rawData.length); i++) {
        const row = rawData[i];
        if (!row) continue;
        const rowStr = row.join(' ').toLowerCase();
        if (
          rowStr.includes('inv. code') || 
          rowStr.includes('inv.code') || 
          rowStr.includes('investor code') ||
          rowStr.includes('client code')
        ) {
          headerRowIndex = i;
          break;
        }
      }
      
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        range: headerRowIndex,
        defval: null 
      });
      
      // Filter out rows that are date headers or empty
      const filteredData = jsonData.filter((row: any) => {
        const firstCol = String(row["SL"] || row["Sl"] || row["sl"] || row["S.L"] || row["S.L."] || Object.values(row)[0] || '').trim();
        if (firstCol.toLowerCase().includes('date')) return false;
        if (!firstCol) return false;
        if (row["SL"] !== undefined && isNaN(Number(firstCol))) return false;
        return true;
      });

      if (filteredData.length === 0) {
        toast.error("No data found in file");
        setStep("upload");
        return;
      }

      // Map Excel columns to database fields
      const mappedRecords = filteredData.map((row: any) => {
        const investorCode = String(
          row["Inv. Code"] ||
          row["Inv.Code"] ||
          row["Investor Code"] || 
          row["investor_code"] || 
          row["InvCode"] || 
          row["Inv Code"] ||
          row["Client Code"] ||
          row["client_code"] ||
          row["Code"] ||
          ""
        ).trim();

        let rawType = String(
          row["Tr. Type"] ||
          row["Tr.Type"] ||
          row["Transaction Type"] ||
          row["transaction_type"] ||
          row["Type"] ||
          row["Trans Type"] ||
          row["TransType"] ||
          ""
        ).trim();
        
        const transactionType = normalizeTransactionType(rawType);

        const debit = parseNumber(row["Debit"] || row["debit"] || 0);
        const credit = parseNumber(row["Credit"] || row["credit"] || 0);
        const rawAmount = row["Amount"] || row["amount"] || row["Amt"];
        
        let amount: number;
        if (rawAmount !== undefined && rawAmount !== null) {
          amount = parseNumber(rawAmount);
        } else {
          amount = credit > 0 ? credit : debit;
        }

        const investorName = 
          row["Inv. Name"] ||
          row["Inv.Name"] ||
          row["Investor Name"] || 
          row["investor_name"] || 
          row["Name"] || 
          row["Client Name"] || 
          null;

        let transactionDate: string | null = fileDate;
        
        const rawDate = 
          row["Transaction Date"] ||
          row["transaction_date"] ||
          row["Trans. Date"] ||
          row["Trans.Date"] ||
          row["Tr. Date"] ||
          row["Tr.Date"] ||
          row["Date"] ||
          row["Trans Date"] ||
          row["TransDate"] ||
          row["ValueDate"] ||
          row["Value Date"] ||
          row["Entry Date"] ||
          null;
        
        if (rawDate !== null && rawDate !== undefined) {
          if (typeof rawDate === "number") {
            const excelEpoch = Date.UTC(1899, 11, 30);
            const jsTimestamp = excelEpoch + rawDate * 86400000;
            const jsDate = new Date(jsTimestamp);
            const year = jsDate.getUTCFullYear();
            const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(jsDate.getUTCDate()).padStart(2, '0');
            transactionDate = `${year}-${m}-${d}`;
          } else if (typeof rawDate === "string") {
            const dateStr = rawDate.trim();
            const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
            if (ddmmyyyy) {
              transactionDate = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              transactionDate = dateStr;
            } else {
              const dmmyyyy = dateStr.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/i);
              if (dmmyyyy) {
                const d = dmmyyyy[1].padStart(2, '0');
                const m = monthMap[dmmyyyy[2].toLowerCase()];
                const y = dmmyyyy[3];
                if (m) transactionDate = `${y}-${m}-${d}`;
              }
            }
          } else if (rawDate instanceof Date) {
            transactionDate = format(rawDate, "yyyy-MM-dd");
          }
        }

        const remarks = 
          row["Descriptions"] ||
          row["Description"] ||
          row["Remarks"] || 
          row["remarks"] || 
          row["Notes"] || 
          row["Comment"] || 
          null;

        return {
          investor_code: investorCode,
          investor_name: investorName,
          transaction_type: transactionType || "DEPOSIT",
          amount: amount,
          transaction_date: transactionDate || format(new Date(), "yyyy-MM-dd"),
          remarks: remarks,
          rm_email: row["RM Email"] || row["rm_email"] || row["RM_Email"] || row["RM"] || null,
        };
      });

      // Validate records
      const { valid, errors } = validateRecords(
        mappedRecords,
        DepositsWithdrawalsRecordSchema
      );

      if (valid.length === 0) {
        toast.error("No valid records to import");
        setStep("upload");
        return;
      }

      // Duplicate detection
      const createDuplicateKey = (investorCode: string, amount: number, transactionType: string, date: string) => {
        return `${investorCode.toUpperCase().trim()}|${Number(amount).toFixed(2)}|${transactionType.toUpperCase().trim()}|${date}`;
      };
      
      const detectedDates = [...new Set(valid.map(r => r.transaction_date || format(new Date(), "yyyy-MM-dd")))];
      setImportDates(detectedDates);
      
      const importCounts = new Map<string, number>();
      valid.forEach(record => {
        const key = createDuplicateKey(
          record.investor_code,
          record.amount,
          record.transaction_type,
          record.transaction_date || format(new Date(), "yyyy-MM-dd")
        );
        importCounts.set(key, (importCounts.get(key) || 0) + 1);
      });
      
      // Check for existing records in cash_ledger_txn table
      let existingRecordsCount = 0;
      const existingCounts = new Map<string, number>();
      
      for (const importDate of detectedDates) {
        // Get existing records from cash_ledger_txn
        const { data: existingData, count, error: countErr } = await supabase
          .from("cash_ledger_txn")
          .select("investor_code, amount, type", { count: "exact" })
          .eq("txn_date", importDate);
        
        if (!countErr && count) {
          existingRecordsCount += count;
        }
        
        if (existingData) {
          existingData.forEach((c: { investor_code: string; amount: number; type: string }) => {
            const key = createDuplicateKey(c.investor_code, c.amount, c.type || "OTHER", importDate);
            existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
          });
        }
      }
      
      const insertCounts = new Map<string, number>();
      const uniqueRecords: typeof valid = [];
      let duplicateCount = 0;
      
      for (const record of valid) {
        const key = createDuplicateKey(
          record.investor_code,
          record.amount,
          record.transaction_type,
          record.transaction_date || format(new Date(), "yyyy-MM-dd")
        );
        const existingCount = existingCounts.get(key) || 0;
        const importCount = importCounts.get(key) || 0;
        const alreadyInsertingCount = insertCounts.get(key) || 0;
        
        const neededCount = Math.max(0, importCount - existingCount);
        
        if (alreadyInsertingCount < neededCount) {
          uniqueRecords.push(record);
          insertCounts.set(key, alreadyInsertingCount + 1);
        } else {
          duplicateCount++;
        }
      }

      // Calculate preview totals
      let totalDeposits = 0;
      let totalWithdrawals = 0;
      let depositCount = 0;
      let withdrawalCount = 0;
      
      uniqueRecords.forEach(record => {
        const upper = record.transaction_type.toUpperCase();
        if (upper === "DEPOSIT") {
          totalDeposits += record.amount;
          depositCount++;
        } else if (upper === "WITHDRAW") {
          totalWithdrawals += record.amount;
          withdrawalCount++;
        }
      });

      const preview: ImportPreviewData = {
        fileDate: fileDate || (detectedDates.length === 1 ? detectedDates[0] : null),
        totalRows: filteredData.length,
        validRows: valid.length,
        errorRows: errors.length,
        duplicateRows: duplicateCount,
        newRows: uniqueRecords.length,
        totalDeposits,
        totalWithdrawals,
        depositCount,
        withdrawalCount,
        existingRecordsCount,
      };

      setPendingRecords(uniqueRecords);
      setAllValidRecords(valid);
      setPreviewData(preview);
      setPreviewOpen(true);
      setStep("preview");
      
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error("Failed to analyze file", { description: error.message });
      setStep("upload");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmImport = async () => {
    const recordsToImport = replaceExisting ? allValidRecords : pendingRecords;
    
    if (recordsToImport.length === 0) {
      toast.info("No records to import");
      setPreviewOpen(false);
      setStep("upload");
      return;
    }

    setStep("importing");
    setPreviewOpen(false);

    try {
      // If replacing, delete existing records for the dates first
      if (replaceExisting && importDates.length > 0) {
        const { error: deleteError } = await supabase
          .from("cash_ledger_txn")
          .delete()
          .in("txn_date", importDates);
        
        if (deleteError) throw deleteError;
      }

      const BATCH_SIZE = 500;
      let inserted = 0;

      for (let i = 0; i < recordsToImport.length; i += BATCH_SIZE) {
        const batch = recordsToImport.slice(i, i + BATCH_SIZE).map((record) => ({
          investor_code: record.investor_code,
          type: record.transaction_type, // Now uses DEPOSIT, WITHDRAW, etc.
          amount: record.amount,
          txn_date: record.transaction_date || format(new Date(), "yyyy-MM-dd"),
          description: record.remarks || null,
          reference: null,
        }));
        
        const { error } = await supabase
          .from("cash_ledger_txn")
          .insert(batch);

        if (error) throw error;
        inserted += batch.length;
      }

      setImportedCount(inserted);
      setStep("complete");
      toast.success(
        replaceExisting 
          ? `Replaced data and imported ${inserted} transactions to cash ledger`
          : `Imported ${inserted} transactions to cash ledger`
      );
      onImportComplete?.();
      
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error("Failed to import records", { description: error.message });
      setStep("upload");
    }
  };

  const handleCancelPreview = () => {
    setPreviewOpen(false);
    setStep("upload");
    setPendingRecords([]);
    setAllValidRecords([]);
    setPreviewData(null);
    setReplaceExisting(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Deposits/Withdrawals
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx, .xls) with deposit and withdrawal transactions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {step === "upload" && (
              <div className="space-y-4">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Excel files (.xlsx, .xls)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium">Expected columns:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Inv. Code / Investor Code / Client Code</li>
                    <li>Tr. Type / Transaction Type (Receipt/Payment)</li>
                    <li>Amount / Debit / Credit</li>
                    <li>Date (optional - detected from file header)</li>
                  </ul>
                </div>
              </div>
            )}

            {step === "analyzing" && (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Analyzing file and detecting duplicates...
                </p>
              </div>
            )}

            {step === "importing" && (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Importing {pendingRecords.length} records...
                </p>
              </div>
            )}

            {step === "complete" && (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <div className="text-center">
                  <p className="font-medium">Import Complete</p>
                  <p className="text-sm text-muted-foreground">
                    Successfully imported {importedCount} transactions
                  </p>
                </div>
                <Button onClick={handleClose}>Close</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ImportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        previewData={previewData}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelPreview}
        showReplaceOption={previewData?.duplicateRows !== undefined && previewData.duplicateRows > 0}
        replaceExisting={replaceExisting}
        onReplaceChange={setReplaceExisting}
      />
    </>
  );
}
