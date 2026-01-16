import { useState, useCallback, useEffect } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, CalendarIcon, AlertTriangle, Loader2, FileSpreadsheet, Database, Users, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ParsedAdminBalance {
  investor_code: string;
  ledger_balance: number;
  investor_name?: string;
  commission_rate?: number;
  account_type?: string; // Cash/Margin
  rm_name?: string;
  rm_email?: string;
  department?: string;
}

interface ImportResults {
  snapshots_imported: number;
  investors_updated: number;
  eod_cleared_after: number;
  errors: string[];
}

// Column mapping patterns
const COLUMN_MAPPINGS: Record<string, string[]> = {
  investor_code: ['Investor Code', 'Inv. Code', 'Inv Code', 'Code', 'investor_code', 'InvCode', 'Client Code', 'Account'],
  ledger_balance: ['Ledger Balance', 'Ledger Balar', 'Ledger Bal', 'Ledger', 'ledger_balance', 'Balance', 'Cash Balance'],
  investor_name: ['Investor Name', 'Name', 'Client Name', 'investor_name', 'InvestorName'],
  commission_rate: ['Commission Rate', 'CommissionRate', 'Commission', 'Brokerage Commission', 'Brokerage', 'commission_rate', 'Comm Rate', 'Comm. Rate'],
  account_type: ['ChargeRate', 'Charge Rate', 'Account Type', 'A/C Type', 'Type', 'account_type', 'AccType', 'Acc Type', 'Cash/Margin'],
  rm_name: ['RM', 'RM Name', 'rm_name', 'rm', 'Relationship Manager', 'Manager'],
  rm_email: ['RM Email', 'rm_email', 'RMEmail', 'RM ID'],
  department: ['Department', 'Dept', 'department', 'Branch', 'Outlet'],
};

export const ImportAdminBalanceDialog = ({ onSuccess }: { onSuccess?: () => void }) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedAdminBalance[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [balanceDate, setBalanceDate] = useState<Date | undefined>(new Date(2026, 0, 12)); // Default to Jan 12, 2026
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState<string>("");
  const [results, setResults] = useState<ImportResults | null>(null);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [isCheckingCount, setIsCheckingCount] = useState(false);
  
  // Options
  const [updateInvestors, setUpdateInvestors] = useState(true);
  const [clearAfterDate, setClearAfterDate] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setIsImporting(false);
    setProgress(0);
    setProgressStage("");
    setResults(null);
    setExistingCount(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    setOpen(newOpen);
  };

  // Check existing record count when date changes
  useEffect(() => {
    const checkExistingCount = async () => {
      if (!balanceDate) {
        setExistingCount(null);
        return;
      }

      setIsCheckingCount(true);
      const dateStr = format(balanceDate, "yyyy-MM-dd");
      
      const { count, error } = await supabase
        .from("eod_ledger_snapshots")
        .select("*", { count: "exact", head: true })
        .eq("eod_date", dateStr);

      if (!error) {
        setExistingCount(count || 0);
      }
      setIsCheckingCount(false);
    };

    checkExistingCount();
  }, [balanceDate]);

  // Normalize column names
  const normalizeColumnName = (col: string): string => {
    return col
      .toLowerCase()
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, '')
      .replace(/[.]/g, '')
      .trim();
  };

  // Find column value using flexible matching
  const findColumnValue = (row: Record<string, unknown>, fieldName: string): unknown => {
    const patterns = COLUMN_MAPPINGS[fieldName] || [];
    
    // First try exact matches
    for (const pattern of patterns) {
      if (row[pattern] !== undefined) return row[pattern];
    }
    
    // Then try normalized matching
    for (const key of Object.keys(row)) {
      const normalizedKey = normalizeColumnName(key);
      for (const pattern of patterns) {
        const normalizedPattern = normalizeColumnName(pattern);
        if (normalizedKey === normalizedPattern || normalizedKey.includes(normalizedPattern)) {
          return row[key];
        }
      }
    }
    
    return undefined;
  };

  // Parse number handling various formats
  const parseNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    
    let str = String(value).trim();
    str = str.replace(/^[\"']|[\"']$/g, '');
    
    // Handle parentheses for negative numbers
    const isNegativeParens = str.startsWith('(') && str.endsWith(')');
    if (isNegativeParens) {
      str = str.slice(1, -1);
    }
    
    // Handle percentage format
    const isPercent = str.endsWith('%');
    if (isPercent) {
      str = str.slice(0, -1);
    }
    
    // Remove commas
    str = str.replace(/,/g, '');
    
    const num = parseFloat(str);
    if (isNaN(num)) return null;
    
    let result = isNegativeParens ? -num : num;
    
    // Convert percentage to decimal if needed (e.g., 0.30% -> 0.0030)
    if (isPercent && num > 1) {
      result = result / 100;
    }
    
    return result;
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

        console.log("Excel columns found:", Object.keys(jsonData[0]));

        const parsed: ParsedAdminBalance[] = [];
        const errors: string[] = [];

        jsonData.forEach((row, index) => {
          const investorCodeRaw = findColumnValue(row, 'investor_code');
          const investorCode = investorCodeRaw ? String(investorCodeRaw).trim() : '';

          if (!investorCode) {
            errors.push(`Row ${index + 2}: Missing investor code`);
            return;
          }

          const ledgerBalance = parseNumber(findColumnValue(row, 'ledger_balance'));
          if (ledgerBalance === null) {
            errors.push(`Row ${index + 2}: Invalid balance for ${investorCode}`);
            return;
          }

          const investorNameRaw = findColumnValue(row, 'investor_name');
          const commissionRateRaw = findColumnValue(row, 'commission_rate');
          const accountTypeRaw = findColumnValue(row, 'account_type');
          const rmNameRaw = findColumnValue(row, 'rm_name');
          const rmEmailRaw = findColumnValue(row, 'rm_email');
          const departmentRaw = findColumnValue(row, 'department');

          parsed.push({
            investor_code: investorCode,
            ledger_balance: ledgerBalance,
            investor_name: investorNameRaw ? String(investorNameRaw).trim() : undefined,
            commission_rate: parseNumber(commissionRateRaw) ?? undefined,
            account_type: accountTypeRaw ? String(accountTypeRaw).trim() : undefined,
            rm_name: rmNameRaw ? String(rmNameRaw).trim() : undefined,
            rm_email: rmEmailRaw ? String(rmEmailRaw).trim() : undefined,
            department: departmentRaw ? String(departmentRaw).trim() : undefined,
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
        setParseError("Failed to parse file. Please ensure it's a valid Excel file.");
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  }, []);

  const handleImport = async () => {
    if (!balanceDate || parsedData.length === 0) {
      toast.error("Please select a date and upload a valid file");
      return;
    }

    // Show confirmation for clearing future EOD data
    if (clearAfterDate) {
      setShowClearConfirm(true);
      return;
    }

    await executeImport();
  };

  const executeImport = async () => {
    if (!balanceDate || parsedData.length === 0) return;

    setShowClearConfirm(false);
    setIsImporting(true);
    setProgress(0);
    setResults(null);

    const dateStr = format(balanceDate, "yyyy-MM-dd");
    const batchSize = 500;
    const importResults: ImportResults = {
      snapshots_imported: 0,
      investors_updated: 0,
      eod_cleared_after: 0,
      errors: [],
    };

    try {
      // STEP 1: Clear existing EOD snapshots for this date
      setProgressStage("Clearing existing snapshots for this date...");
      const { error: deleteError } = await supabase
        .from("eod_ledger_snapshots")
        .delete()
        .eq("eod_date", dateStr);

      if (deleteError) {
        importResults.errors.push(`Failed to clear existing snapshots: ${deleteError.message}`);
        throw new Error(deleteError.message);
      }
      setProgress(5);

      // STEP 2: Clear EOD data AFTER this date if requested
      if (clearAfterDate) {
        setProgressStage("Clearing EOD data after baseline date...");
        
        // Clear eod_ledger_snapshots after this date
        const { data: deletedSnapshots, error: snapshotClearError } = await supabase
          .from("eod_ledger_snapshots")
          .delete()
          .gt("eod_date", dateStr)
          .select("id");

        if (snapshotClearError) {
          importResults.errors.push(`Failed to clear future snapshots: ${snapshotClearError.message}`);
        } else {
          importResults.eod_cleared_after = deletedSnapshots?.length || 0;
        }

        // Clear eod_run_history after this date
        const { error: historyClearError } = await supabase
          .from("eod_run_history")
          .delete()
          .gt("run_date", dateStr);

        if (historyClearError) {
          importResults.errors.push(`Failed to clear future run history: ${historyClearError.message}`);
        }
      }
      setProgress(15);

      // STEP 3: Import EOD ledger snapshots
      setProgressStage("Importing ledger snapshots...");
      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize);
        
        const records = batch.map((item) => ({
          eod_date: dateStr,
          investor_code: item.investor_code,
          ledger_balance: item.ledger_balance,
          investor_name: item.investor_name || null,
          rm_email: item.rm_email || null,
        }));

        const { error } = await supabase
          .from("eod_ledger_snapshots")
          .insert(records);

        if (error) {
          console.error("Snapshot insert error:", error);
          importResults.errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          importResults.snapshots_imported += batch.length;
        }

        const snapshotProgress = 15 + ((i + batch.length) / parsedData.length) * 40;
        setProgress(Math.round(snapshotProgress));
      }

      // STEP 4: Update investors with commission rates and account types
      if (updateInvestors) {
        setProgressStage("Updating investor commission rates...");
        
        const investorsToUpdate = parsedData.filter(
          (item) => item.commission_rate !== undefined || item.account_type !== undefined
        );

        for (let i = 0; i < investorsToUpdate.length; i += batchSize) {
          const batch = investorsToUpdate.slice(i, i + batchSize);

          for (const item of batch) {
            const updateData: Record<string, unknown> = {};
            
            if (item.commission_rate !== undefined) {
              updateData.brokerage_commission = item.commission_rate;
            }
            if (item.account_type !== undefined) {
              // Map ChargeRate values to account_type
              const accType = item.account_type.toLowerCase();
              if (accType.includes('margin')) {
                updateData.account_type = 'Margin';
              } else if (accType.includes('cash')) {
                updateData.account_type = 'Cash';
              } else {
                updateData.account_type = item.account_type;
              }
            }

            if (Object.keys(updateData).length > 0) {
              const { error } = await supabase
                .from("investors")
                .update(updateData)
                .eq("investor_code", item.investor_code);

              if (!error) {
                importResults.investors_updated++;
              }
            }
          }

          const investorProgress = 55 + ((i + batch.length) / investorsToUpdate.length) * 40;
          setProgress(Math.round(investorProgress));
        }
      }

      setProgress(100);
      setProgressStage("Complete!");
      setResults(importResults);

      if (importResults.errors.length === 0) {
        toast.success(
          `Baseline import complete: ${importResults.snapshots_imported} snapshots, ${importResults.investors_updated} investors updated`
        );
        onSuccess?.();
      } else {
        toast.warning(`Import completed with ${importResults.errors.length} errors`);
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Import failed");
      setResults(importResults);
    } finally {
      setIsImporting(false);
    }
  };

  // Stats for preview
  const stats = {
    totalBalance: parsedData.reduce((sum, item) => sum + item.ledger_balance, 0),
    withCommission: parsedData.filter((item) => item.commission_rate !== undefined).length,
    withAccountType: parsedData.filter((item) => item.account_type !== undefined).length,
    marginAccounts: parsedData.filter((item) => item.account_type?.toLowerCase().includes('margin')).length,
    cashAccounts: parsedData.filter((item) => item.account_type?.toLowerCase().includes('cash')).length,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="default" className="gap-2">
            <Database className="h-4 w-4" />
            Import Admin Balance Baseline
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Admin Balance as EOD Baseline
            </DialogTitle>
            <DialogDescription>
              Upload the Admin Balance Excel file to establish a verified baseline for EOD calculations.
              This will import ledger balances and optionally update investor commission rates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Date Picker */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Baseline Date</label>
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
                This date will be used as the EOD baseline. Future EODs will calculate from this point.
              </p>

              {/* Existing Records Count */}
              {balanceDate && (
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-sm">
                    {isCheckingCount ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking...
                      </span>
                    ) : existingCount !== null && existingCount > 0 ? (
                      <span className="text-amber-600 dark:text-amber-500">
                        {existingCount.toLocaleString()} existing records for this date (will be replaced)
                      </span>
                    ) : existingCount === 0 ? (
                      <span className="text-muted-foreground">No existing records for this date</span>
                    ) : null}
                  </span>
                </div>
              )}
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Admin Balance File</label>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                  "hover:border-primary/50 hover:bg-muted/50",
                  file && "border-primary bg-primary/5"
                )}
                onClick={() => document.getElementById("admin-balance-file-input")?.click()}
              >
                <input
                  id="admin-balance-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click or drag to upload Admin Balance Excel file
                  </p>
                )}
              </div>
            </div>

            {/* Parse Error */}
            {parseError && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                {parseError}
              </div>
            )}

            {/* Parsed Data Preview */}
            {parsedData.length > 0 && (
              <div className="bg-muted/50 p-4 rounded-md space-y-3">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Parsed Data Summary
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Total Records: <span className="font-medium">{parsedData.length.toLocaleString()}</span></div>
                  <div>Total Balance: <span className="font-medium">{stats.totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                  <div>With Commission Rate: <span className="font-medium">{stats.withCommission.toLocaleString()}</span></div>
                  <div>With Account Type: <span className="font-medium">{stats.withAccountType.toLocaleString()}</span></div>
                  <div>Margin Accounts: <span className="font-medium">{stats.marginAccounts.toLocaleString()}</span></div>
                  <div>Cash Accounts: <span className="font-medium">{stats.cashAccounts.toLocaleString()}</span></div>
                </div>
              </div>
            )}

            {/* Import Options */}
            {parsedData.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Import Options</h4>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="update-investors"
                    checked={updateInvestors}
                    onCheckedChange={(checked) => setUpdateInvestors(checked === true)}
                  />
                  <label htmlFor="update-investors" className="text-sm cursor-pointer">
                    Update investor commission rates and account types
                  </label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clear-after"
                    checked={clearAfterDate}
                    onCheckedChange={(checked) => setClearAfterDate(checked === true)}
                  />
                  <label htmlFor="clear-after" className="text-sm cursor-pointer flex items-center gap-1">
                    <Trash2 className="h-3 w-3 text-destructive" />
                    Clear all EOD data after {balanceDate ? format(balanceDate, "MMM d, yyyy") : "this date"}
                  </label>
                </div>
                
                {clearAfterDate && (
                  <div className="text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 p-2 rounded-md">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    This will delete all EOD snapshots and run history after {balanceDate ? format(balanceDate, "MMM d, yyyy") : "this date"}.
                    You can then run fresh EOD calculations from the next day.
                  </div>
                )}
              </div>
            )}

            {/* Progress */}
            {isImporting && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{progressStage}</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {/* Results */}
            {results && (
              <div className={cn(
                "p-4 rounded-md",
                results.errors.length === 0 ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}>
                <h4 className="font-medium mb-2">Import Results</h4>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  <div>Snapshots Imported:</div>
                  <div className="font-medium">{results.snapshots_imported.toLocaleString()}</div>
                  <div>Investors Updated:</div>
                  <div className="font-medium">{results.investors_updated.toLocaleString()}</div>
                  {results.eod_cleared_after > 0 && (
                    <>
                      <div>Future EOD Cleared:</div>
                      <div className="font-medium">{results.eod_cleared_after.toLocaleString()} records</div>
                    </>
                  )}
                </div>
                {results.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="font-medium">Errors:</div>
                    {results.errors.slice(0, 3).map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                    {results.errors.length > 3 && <div>...and {results.errors.length - 3} more</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {results ? "Close" : "Cancel"}
            </Button>
            {!results && (
              <Button 
                onClick={handleImport} 
                disabled={!balanceDate || parsedData.length === 0 || isImporting}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Import Baseline
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Clearing Future EOD */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm EOD Data Clearing
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Import {parsedData.length.toLocaleString()} ledger snapshots for {balanceDate ? format(balanceDate, "MMMM d, yyyy") : ""}</li>
                {updateInvestors && <li>Update investor commission rates</li>}
                <li className="text-destructive">Delete ALL EOD snapshots and run history after {balanceDate ? format(balanceDate, "MMMM d, yyyy") : ""}</li>
              </ul>
              <div className="mt-3 font-medium">
                After import, you can run fresh EOD calculations starting from {balanceDate ? format(new Date(balanceDate.getTime() + 86400000), "MMMM d, yyyy") : "the next day"}.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeImport} className="bg-primary">
              Confirm & Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
