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
import { Upload, CalendarIcon, AlertTriangle, Loader2, FileSpreadsheet, Database, Users, Trash2, Package } from "lucide-react";
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
  // Holdings data
  instrument?: string;
  boid?: string;
  total_stock?: number;
  saleable?: number;
  avg_cost?: number;
  total_cost?: number;
  market_value?: number;
}

interface ImportResults {
  snapshots_imported: number;
  investors_updated: number;
  holdings_imported: number;
  eod_cleared_after: number;
  errors: string[];
}

// Column mapping patterns
const COLUMN_MAPPINGS: Record<string, string[]> = {
  investor_code: ['Investor Code', 'Inv. Code', 'Inv Code', 'Code', 'investor_code', 'InvCode', 'Client Code', 'Account'],
  ledger_balance: ['Ledger Balance', 'Ledger Balar', 'Ledger Bal', 'Ledger', 'ledger_balance', 'Balance', 'Cash Balance'],
  investor_name: ['Investor Name', 'Name', 'Client Name', 'investor_name', 'InvestorName'],
  commission_rate: ['Commission Rate', 'CommissionRate', 'Commission', 'Brokerage Commission', 'Brokerage', 'commission_rate', 'Comm Rate', 'Comm. Rate'],
  account_type: ['Account Type', 'A/C Type', 'AccType', 'Acc Type', 'account_type', 'Cash/Margin', 'Type', 'ChargeRate', 'Charge Rate'],
  rm_name: ['RM', 'RM Name', 'rm_name', 'rm', 'Relationship Manager', 'Manager'],
  rm_email: ['RM Email', 'rm_email', 'RMEmail', 'RM ID'],
  department: ['Department', 'Dept', 'department', 'Branch', 'Outlet'],
  // Holdings columns
  instrument: ['Instrument', 'Trading Code', 'Script', 'Security', 'Symbol', 'Stock', 'Scrip'],
  total_stock: ['TotalStock', 'Total Stock', 'Total Qty', 'Qty', 'Quantity', 'Holdings', 'Total Quantity'],
  saleable: ['Saleable', 'Saleable Qty', 'SaleableQty', 'Sellable', 'Available', 'Free Qty'],
  avg_cost: ['AvgCost', 'Avg Cost', 'Average Cost', 'Avg. Cost', 'Unit Cost', 'Avg Price'],
  total_cost: ['Total Cost', 'TotalCost', 'Cost', 'Cost Value', 'Total Purchase'],
  market_value: ['Total M.V.', 'Total MV', 'Market Value', 'M.V.', 'MV', 'TotalMV', 'Current Value'],
  boid: ['BOID', 'BO ID', 'Beneficiary ID', 'BO Account', 'BO'],
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
  const [updateHoldings, setUpdateHoldings] = useState(true);
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
      
      // Check eod_investor_balance table (new table)
      const { count, error } = await supabase
        .from("eod_investor_balance")
        .select("*", { count: "exact", head: true })
        .eq("trade_date", dateStr);

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
        
        // Read ALL sheets, not just the first one
        const allJsonData: Record<string, unknown>[] = [];
        const sheetStats: { name: string; rows: number }[] = [];
        
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const sheetData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];
          console.log(`Sheet "${sheetName}": ${sheetData.length} rows`);
          sheetStats.push({ name: sheetName, rows: sheetData.length });
          allJsonData.push(...sheetData);
        }
        
        console.log(`Total rows from ${workbook.SheetNames.length} sheets: ${allJsonData.length}`);

        if (allJsonData.length === 0) {
          setParseError("File is empty or has no data rows");
          return;
        }

        console.log("Excel columns found:", Object.keys(allJsonData[0]));

        const parsed: ParsedAdminBalance[] = [];
        const errors: string[] = [];

        allJsonData.forEach((row, index) => {
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
          
          // Holdings data
          const instrumentRaw = findColumnValue(row, 'instrument');
          const boidRaw = findColumnValue(row, 'boid');
          const totalStockRaw = findColumnValue(row, 'total_stock');
          const saleableRaw = findColumnValue(row, 'saleable');
          const avgCostRaw = findColumnValue(row, 'avg_cost');
          const totalCostRaw = findColumnValue(row, 'total_cost');
          const marketValueRaw = findColumnValue(row, 'market_value');

          parsed.push({
            investor_code: investorCode,
            ledger_balance: ledgerBalance,
            investor_name: investorNameRaw ? String(investorNameRaw).trim() : undefined,
            commission_rate: parseNumber(commissionRateRaw) ?? undefined,
            account_type: accountTypeRaw ? String(accountTypeRaw).trim() : undefined,
            rm_name: rmNameRaw ? String(rmNameRaw).trim() : undefined,
            rm_email: rmEmailRaw ? String(rmEmailRaw).trim() : undefined,
            department: departmentRaw ? String(departmentRaw).trim() : undefined,
            // Holdings
            instrument: instrumentRaw ? String(instrumentRaw).trim() : undefined,
            boid: boidRaw ? String(boidRaw).trim() : undefined,
            total_stock: parseNumber(totalStockRaw) ?? undefined,
            saleable: parseNumber(saleableRaw) ?? undefined,
            avg_cost: parseNumber(avgCostRaw) ?? undefined,
            total_cost: parseNumber(totalCostRaw) ?? undefined,
            market_value: parseNumber(marketValueRaw) ?? undefined,
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
        const sheetInfo = sheetStats.map(s => `${s.name}: ${s.rows}`).join(", ");
        toast.success(`Parsed ${parsed.length} balance records from ${workbook.SheetNames.length} sheets (${sheetInfo})`);
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
      holdings_imported: 0,
      eod_cleared_after: 0,
      errors: [],
    };

    // Deduplicate investors for ledger snapshots (multiple rows per investor due to holdings)
    const uniqueInvestors = new Map<string, ParsedAdminBalance>();
    parsedData.forEach(item => {
      if (!uniqueInvestors.has(item.investor_code)) {
        uniqueInvestors.set(item.investor_code, item);
      }
    });
    const snapshotData = Array.from(uniqueInvestors.values());

    try {
      // STEP 1: Clear existing eod_investor_balance for this date
      setProgressStage("Clearing existing balances for this date...");
      const { error: deleteError } = await supabase
        .from("eod_investor_balance")
        .delete()
        .eq("trade_date", dateStr);

      if (deleteError) {
        importResults.errors.push(`Failed to clear existing balances: ${deleteError.message}`);
        throw new Error(deleteError.message);
      }
      setProgress(5);

      // STEP 2: Clear EOD data AFTER this date if requested
      if (clearAfterDate) {
        setProgressStage("Clearing EOD data after baseline date...");
        
        // Clear eod_investor_balance after this date
        const { data: deletedSnapshots, error: snapshotClearError } = await supabase
          .from("eod_investor_balance")
          .delete()
          .gt("trade_date", dateStr)
          .select("investor_code");

        if (snapshotClearError) {
          importResults.errors.push(`Failed to clear future balances: ${snapshotClearError.message}`);
        } else {
          importResults.eod_cleared_after = deletedSnapshots?.length || 0;
        }

        // Also clear old eod_run_history if it exists
        const { error: historyClearError } = await supabase
          .from("eod_run_history")
          .delete()
          .gt("run_date", dateStr);

        if (historyClearError) {
          importResults.errors.push(`Failed to clear future run history: ${historyClearError.message}`);
        }
      }
      setProgress(15);

      // STEP 3: Import to eod_investor_balance (new table with more fields)
      setProgressStage(`Importing ${snapshotData.length} unique investor balances...`);
      for (let i = 0; i < snapshotData.length; i += batchSize) {
        const batch = snapshotData.slice(i, i + batchSize);
        
        const records = batch.map((item) => ({
          trade_date: dateStr,
          investor_code: item.investor_code,
          boid: item.boid || null,
          rm_id: item.rm_email || null, // Map rm_email to rm_id for now
          opening_ledger_balance: 0, // Baseline has no prior
          matured_balance: 0,
          receivable_sales: 0,
          cheque_in_tran_hand: 0,
          accrued_int: 0,
          closing_ledger_balance: item.ledger_balance,
          equity: (item.market_value || 0) + item.ledger_balance,
          d_e_rate: null,
        }));

        const { error } = await supabase
          .from("eod_investor_balance")
          .insert(records);

        if (error) {
          console.error("Balance insert error:", error);
          importResults.errors.push(`Balance batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          importResults.snapshots_imported += batch.length;
        }

        const snapshotProgress = 15 + ((i + batch.length) / snapshotData.length) * 25;
        setProgress(Math.round(snapshotProgress));
      }

      // STEP 4: Update investors with ledger_balance, commission rates and account types (BULK UPDATE)
      // Always update ledger_balance to establish baseline in master table
      setProgressStage("Updating investor baseline balances...");
      
      // Use deduplicated data for investor updates - always update ledger_balance
      const investorsToUpdate = Array.from(uniqueInvestors.values());
      const bulkChunkSize = 100; // Safe chunk size for .in() to avoid URL length issues
      
      // First, update ledger_balance for ALL investors (baseline balance)
      for (let i = 0; i < investorsToUpdate.length; i += bulkChunkSize) {
        const chunk = investorsToUpdate.slice(i, i + bulkChunkSize);
        
        // Update each investor's ledger_balance individually since values differ
        for (const item of chunk) {
          const { error } = await supabase
            .from("investors")
            .update({ ledger_balance: item.ledger_balance })
            .eq("investor_code", item.investor_code);
          
          if (error) {
            console.error(`Failed to update ledger_balance for ${item.investor_code}:`, error.message);
          }
        }
        
        const baselineProgress = 40 + ((i + chunk.length) / investorsToUpdate.length) * 10;
        setProgress(Math.round(baselineProgress));
      }
      
      // Then update commission rates and account types if enabled
      if (updateInvestors) {
        setProgressStage("Updating investor commission rates...");
        
        const investorsWithRates = investorsToUpdate.filter(
          (item) => item.commission_rate !== undefined || item.account_type !== undefined
        );

        // Group investors by their update payload to enable bulk updates
        const updateGroups = new Map<string, { updateData: Record<string, unknown>; investorCodes: string[] }>();
        
        // Format the selected date as string for notes
        const effectiveDateStr = balanceDate ? format(balanceDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
        
        for (const item of investorsWithRates) {
          const updateData: Record<string, unknown> = {};
          
          if (item.commission_rate !== undefined) {
            updateData.brokerage_commission = item.commission_rate;
            // Set commission effective date and notes when updating commission
            updateData.commission_effective_date = effectiveDateStr;
            updateData.commission_notes = `Imported from Admin Balance ${effectiveDateStr}`;
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
            // Create a key based on the update payload
            const groupKey = `${updateData.brokerage_commission ?? ''}|${updateData.account_type ?? ''}`;
            
            if (!updateGroups.has(groupKey)) {
              updateGroups.set(groupKey, { updateData, investorCodes: [] });
            }
            updateGroups.get(groupKey)!.investorCodes.push(item.investor_code);
          }
        }

        // Perform bulk updates per group with chunking to avoid URL length limits
        const totalToUpdate = investorsWithRates.length;
        let processedCount = 0;

        for (const [, group] of updateGroups) {
          const { updateData, investorCodes } = group;
          
          // Chunk the investor codes for this group
          for (let i = 0; i < investorCodes.length; i += bulkChunkSize) {
            const chunk = investorCodes.slice(i, i + bulkChunkSize);
            
            const { error, count } = await supabase
              .from("investors")
              .update(updateData)
              .in("investor_code", chunk);

            if (!error) {
              importResults.investors_updated += chunk.length;
            } else {
              console.error(`Bulk update failed for chunk:`, error);
            }
            
            processedCount += chunk.length;
            const investorProgress = 50 + (processedCount / totalToUpdate) * 10;
            setProgress(Math.round(investorProgress));
          }
        }
      }

      // STEP 5: Import Holdings (if enabled)
      if (updateHoldings) {
        // Filter rows that have instrument data
        const holdingsToImport = parsedData.filter(item => 
          item.instrument && item.instrument.trim() !== '' && item.total_stock !== undefined
        );

        if (holdingsToImport.length > 0) {
          setProgressStage(`Clearing and importing ${holdingsToImport.length} stock holdings...`);
          
          // Clear ALL existing holdings using batched RPC to avoid timeout
          setProgressStage("Clearing existing holdings (this may take a moment)...");
          const { data: deletedCount, error: holdingsClearError } = await supabase.rpc('delete_all_holdings');
          
          if (holdingsClearError) {
            importResults.errors.push(`Failed to clear holdings: ${holdingsClearError.message}`);
          } else {
            console.log(`Cleared ${deletedCount} existing holdings`);
          }

          setProgress(65);

          // Batch insert new holdings
          for (let i = 0; i < holdingsToImport.length; i += batchSize) {
            const batch = holdingsToImport.slice(i, i + batchSize);
            
            const records = batch.map(item => ({
              trading_code: item.instrument!,
              investor_code: item.investor_code,
              investor_name: item.investor_name || null,
              boid: item.boid || null,
              total_stock: item.total_stock || 0,
              saleable: item.saleable || 0,
              avg_cost: item.avg_cost || 0,
              total_cost: item.total_cost || 0,
              market_value: item.market_value || 0,
              ledger_balance: item.ledger_balance,
              rm_email: item.rm_email || null,
            }));

            const { error } = await supabase
              .from("holdings")
              .insert(records);

            if (error) {
              console.error("Holdings insert error:", error);
              importResults.errors.push(`Holdings batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
            } else {
              importResults.holdings_imported += batch.length;
            }

            const holdingsProgress = 65 + ((i + batch.length) / holdingsToImport.length) * 30;
            setProgress(Math.round(holdingsProgress));
          }
        }
      }

      setProgress(100);
      setProgressStage("Complete!");
      setResults(importResults);

      if (importResults.errors.length === 0) {
        const parts = [
          `${importResults.snapshots_imported} snapshots`,
          `${importResults.investors_updated} investors`,
        ];
        if (importResults.holdings_imported > 0) {
          parts.push(`${importResults.holdings_imported} holdings`);
        }
        toast.success(`Baseline import complete: ${parts.join(', ')}`);
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
  const uniqueInvestorCount = new Set(parsedData.map(i => i.investor_code)).size;
  const holdingsRows = parsedData.filter(i => i.instrument && i.instrument.trim() !== '' && i.total_stock !== undefined);
  const uniqueInstruments = new Set(holdingsRows.map(i => i.instrument));
  
  const stats = {
    totalRows: parsedData.length,
    uniqueInvestors: uniqueInvestorCount,
    totalBalance: parsedData.reduce((sum, item, index, arr) => {
      // Only count balance once per investor
      const firstIndex = arr.findIndex(i => i.investor_code === item.investor_code);
      return index === firstIndex ? sum + item.ledger_balance : sum;
    }, 0),
    withCommission: parsedData.filter((item) => item.commission_rate !== undefined).length,
    withAccountType: parsedData.filter((item) => item.account_type !== undefined).length,
    marginAccounts: new Set(parsedData.filter((item) => item.account_type?.toLowerCase().includes('margin')).map(i => i.investor_code)).size,
    cashAccounts: new Set(parsedData.filter((item) => item.account_type?.toLowerCase().includes('cash')).map(i => i.investor_code)).size,
    // Holdings stats
    holdingsCount: holdingsRows.length,
    uniqueInstrumentsCount: uniqueInstruments.size,
    totalMarketValue: holdingsRows.reduce((sum, i) => sum + (i.market_value || 0), 0),
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
                  <div>Total Rows: <span className="font-medium">{stats.totalRows.toLocaleString()}</span></div>
                  <div>Unique Investors: <span className="font-medium">{stats.uniqueInvestors.toLocaleString()}</span></div>
                  <div>Total Ledger Balance: <span className="font-medium">{stats.totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                  <div>With Commission Rate: <span className="font-medium">{stats.withCommission.toLocaleString()}</span></div>
                  <div>Margin Accounts: <span className="font-medium">{stats.marginAccounts.toLocaleString()}</span></div>
                  <div>Cash Accounts: <span className="font-medium">{stats.cashAccounts.toLocaleString()}</span></div>
                </div>
                
                {/* Holdings Stats */}
                {stats.holdingsCount > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <h5 className="font-medium text-sm flex items-center gap-2 mb-2">
                      <Package className="h-4 w-4" />
                      Stock Holdings
                    </h5>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Holdings Rows: <span className="font-medium">{stats.holdingsCount.toLocaleString()}</span></div>
                      <div>Unique Instruments: <span className="font-medium">{stats.uniqueInstrumentsCount.toLocaleString()}</span></div>
                      <div className="col-span-2">Total Market Value: <span className="font-medium">{stats.totalMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                    </div>
                  </div>
                )}
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
                    id="update-holdings"
                    checked={updateHoldings}
                    onCheckedChange={(checked) => setUpdateHoldings(checked === true)}
                  />
                  <label htmlFor="update-holdings" className="text-sm cursor-pointer flex items-center gap-1">
                    <Package className="h-3 w-3 text-primary" />
                    Replace all holdings with {stats.holdingsCount.toLocaleString()} stock positions
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
                  {results.holdings_imported > 0 && (
                    <>
                      <div>Holdings Imported:</div>
                      <div className="font-medium">{results.holdings_imported.toLocaleString()}</div>
                    </>
                  )}
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
