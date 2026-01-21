import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarIcon, Loader2, Play, AlertTriangle, ShieldCheck, RefreshCw, Trash2, Search, Download, Eye, ArrowUpDown, Square, Calendar as CalendarRange } from "lucide-react";
import { format, addDays, parse, eachDayOfInterval, differenceInDays } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/supabase-utils";
import { rpcWithRetry, formatRpcError } from "@/lib/rpc-utils";
import type { DateRange } from "react-day-picker";

interface BatchEodRunnerProps {
  onComplete?: () => void;
}

interface MismatchDetail {
  investorCode: string;
  storedBalance: number;
  expectedBalance: number;
  difference: number;
  baseBalance: number;
  totalBuys: number;
  totalSells: number;
  deposits: number;
  withdrawals: number;
}

interface StaleWarning {
  date: string;
  mismatchCount: number;
  mismatches: MismatchDetail[];
  suggestedStartDate: Date | null;
  totalDifference: number;
}

interface BatchEodResult {
  success: boolean;
  skipped?: boolean;
  message?: string;
  eod_date?: string;
  clients_captured?: number;
  total_ledger_balance?: number;
  trade_files_count?: number;
  deposit_records_count?: number;
  gross_buy?: number;
  gross_sell?: number;
  total_commission?: number;
  total_deposits?: number;
  total_withdrawals?: number;
  error?: string;
  error_detail?: string;
  errors?: string[];
}

interface DayResult {
  date: string;
  success: boolean;
  skipped?: boolean;
  clients?: number;
  tradeFiles?: number;
  depositRecords?: number;
  grossBuy?: number;
  grossSell?: number;
  error?: string;
}

type SortField = 'investorCode' | 'storedBalance' | 'expectedBalance' | 'difference';
type SortDirection = 'asc' | 'desc';
type EodMode = 'single' | 'range';

const MAX_RANGE_DAYS = 60;

export const BatchEodRunner = ({ onComplete }: BatchEodRunnerProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EodMode>('single');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDateProcessing, setCurrentDateProcessing] = useState<string>("");
  const [processedDays, setProcessedDays] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  const [dayResults, setDayResults] = useState<DayResult[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [staleWarning, setStaleWarning] = useState<StaleWarning | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showMismatchDetails, setShowMismatchDetails] = useState(false);
  const [showResultDetails, setShowResultDetails] = useState(false);
  const [mismatchSearch, setMismatchSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>('difference');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [skipExisting, setSkipExisting] = useState(false);

  // Filter and sort mismatches
  const filteredMismatches = useMemo(() => {
    if (!staleWarning?.mismatches) return [];
    
    let filtered = staleWarning.mismatches;
    
    // Apply search filter
    if (mismatchSearch) {
      const search = mismatchSearch.toUpperCase();
      filtered = filtered.filter(m => m.investorCode.toUpperCase().includes(search));
    }
    
    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'investorCode':
          comparison = a.investorCode.localeCompare(b.investorCode);
          break;
        case 'storedBalance':
          comparison = a.storedBalance - b.storedBalance;
          break;
        case 'expectedBalance':
          comparison = a.expectedBalance - b.expectedBalance;
          break;
        case 'difference':
          comparison = Math.abs(a.difference) - Math.abs(b.difference);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  }, [staleWarning?.mismatches, mismatchSearch, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const exportMismatchesToCsv = () => {
    if (!staleWarning?.mismatches) return;
    
    const headers = ['Investor Code', 'Stored Balance', 'Expected Balance', 'Difference', 'Base Balance', 'Total Buys', 'Total Sells', 'Deposits', 'Withdrawals'];
    const rows = staleWarning.mismatches.map(m => [
      m.investorCode,
      m.storedBalance.toFixed(2),
      m.expectedBalance.toFixed(2),
      m.difference.toFixed(2),
      m.baseBalance.toFixed(2),
      m.totalBuys.toFixed(2),
      m.totalSells.toFixed(2),
      m.deposits.toFixed(2),
      m.withdrawals.toFixed(2),
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eod-mismatches-${staleWarning.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  // Verify previous day EOD when date changes
  const verifyPreviousDayEod = useCallback(async (dateToProcess: Date) => {
    setVerifying(true);
    setStaleWarning(null);

    try {
      const prevDay = format(addDays(dateToProcess, -1), "yyyy-MM-dd");
      const twoDaysBefore = format(addDays(dateToProcess, -2), "yyyy-MM-dd");
      const prevDayTradeFormat = format(addDays(dateToProcess, -1), "yyyyMMdd");

      // Fetch stored EOD for previous day
      const storedEod = await fetchAllRows<{
        investor_code: string;
        ledger_balance: number;
      }>((from, to) =>
        supabase
          .from("eod_ledger_snapshots")
          .select("investor_code, ledger_balance")
          .eq("eod_date", prevDay)
          .range(from, to)
      );

      // If no stored EOD for previous day, can't verify (first run scenario)
      if (!storedEod || storedEod.length === 0) {
        setVerifying(false);
        return;
      }

      // Fetch base balances (from 2 days before)
      const baseEod = await fetchAllRows<{
        investor_code: string;
        ledger_balance: number;
      }>((from, to) =>
        supabase
          .from("eod_ledger_snapshots")
          .select("investor_code, ledger_balance")
          .eq("eod_date", twoDaysBefore)
          .range(from, to)
      );

      // Fetch base balances from clients table (ledger_balance snapshot)
      const clients = await fetchAllRows<{
        inv_code: string;
        ledger_balance: number;
      }>((from, to) =>
        supabase
          .from("clients")
          .select("inv_code, ledger_balance")
          .range(from, to)
      );

      // Fetch commission rates from investors table (single source of truth)
      const investorData = await fetchAllRows<{
        investor_code: string;
        brokerage_commission: number | null;
      }>((from, to) =>
        supabase
          .from("investors")
          .select("investor_code, brokerage_commission")
          .range(from, to)
      );

      const commissionMap = new Map<string, number>();
      investorData?.forEach((inv) => {
        if (inv.investor_code) {
          // Normalize commission rate: if >= 0.1, treat as percentage and divide by 100
          const rawRate = inv.brokerage_commission || 0;
          const normalizedRate = rawRate >= 0.1 ? rawRate / 100 : rawRate;
          commissionMap.set(inv.investor_code.toUpperCase(), normalizedRate);
        }
      });

      // Build base balance map from clients table
      const baseBalances = new Map<string, number>();
      clients?.forEach((c) => {
        baseBalances.set(c.inv_code.toUpperCase(), c.ledger_balance || 0);
      });
      // Override with base EOD data if available (more recent snapshot)
      baseEod?.forEach((row) => {
        baseBalances.set(row.investor_code.toUpperCase(), row.ledger_balance || 0);
      });

      // Fetch previous day's trades
      const { data: prevDayTrades } = await supabase
        .from("trade_history")
        .select("client_code, side, value, fill_type, status")
        .eq("trade_date", prevDayTradeFormat);

      // Fetch previous day's transactions
      const { data: prevDayTx } = await supabase
        .from("deposits_withdrawals")
        .select("investor_code, amount, transaction_type")
        .eq("transaction_date", prevDay);

      // Process transactions
      const txMap = new Map<string, { deposits: number; withdrawals: number }>();
      prevDayTx?.forEach((tx) => {
        const code = tx.investor_code.toUpperCase();
        const current = txMap.get(code) || { deposits: 0, withdrawals: 0 };
        if (tx.transaction_type.toLowerCase().includes("deposit")) {
          current.deposits += tx.amount || 0;
        } else {
          current.withdrawals += tx.amount || 0;
        }
        txMap.set(code, current);
      });

      // Process trades - now handles B/S and checks both status and fill_type
      const tradeMap = new Map<string, { grossBuys: number; netSells: number }>();
      prevDayTrades?.forEach((trade) => {
        if (!trade.client_code || !trade.value) return;
        const fillType = (trade.fill_type || "").toUpperCase();
        const status = (trade.status || "").toUpperCase();
        // Check both status and fill_type for filled trades
        if (!["FILL", "PF", "FILLED", "PARTIAL"].includes(fillType) && 
            !["FILL", "PF", "FILLED", "PARTIAL"].includes(status)) return;

        const clientCode = trade.client_code.toUpperCase();
        const commissionRate = commissionMap.get(clientCode) || 0;
        const current = tradeMap.get(clientCode) || { grossBuys: 0, netSells: 0 };
        const side = (trade.side || "").toUpperCase();

        if (side === "BUY" || side === "B") {
          current.grossBuys += trade.value * (1 + commissionRate);
        } else if (side === "SELL" || side === "S") {
          current.netSells += trade.value * (1 - commissionRate);
        }
        tradeMap.set(clientCode, current);
      });

      // Compare stored vs expected and collect detailed mismatches
      const mismatches: MismatchDetail[] = [];
      const TOLERANCE = 0.01; // Allow 1 paisa difference

      storedEod.forEach((row) => {
        const code = row.investor_code.toUpperCase();
        const baseBalance = baseBalances.get(code) || 0;
        const tx = txMap.get(code) || { deposits: 0, withdrawals: 0 };
        const trades = tradeMap.get(code) || { grossBuys: 0, netSells: 0 };
        
        const expectedBalance = baseBalance + tx.deposits - tx.withdrawals + trades.netSells - trades.grossBuys;
        const diff = row.ledger_balance - expectedBalance;
        
        if (Math.abs(diff) > TOLERANCE) {
          mismatches.push({
            investorCode: row.investor_code,
            storedBalance: row.ledger_balance,
            expectedBalance: expectedBalance,
            difference: diff,
            baseBalance: baseBalance,
            totalBuys: trades.grossBuys,
            totalSells: trades.netSells,
            deposits: tx.deposits,
            withdrawals: tx.withdrawals,
          });
        }
      });

      if (mismatches.length > 0) {
        // Find safe start date (day before earliest trade)
        const { data: earliestTrade } = await supabase
          .from("trade_history")
          .select("trade_date")
          .order("trade_date", { ascending: true })
          .limit(1);

        let suggestedStartDate: Date | null = null;
        if (earliestTrade?.[0]?.trade_date) {
          const earliestDate = parse(earliestTrade[0].trade_date, "yyyyMMdd", new Date());
          suggestedStartDate = addDays(earliestDate, -1);
        }

        // Calculate total difference
        const totalDifference = mismatches.reduce((sum, m) => sum + m.difference, 0);

        setStaleWarning({
          date: prevDay,
          mismatchCount: mismatches.length,
          mismatches,
          suggestedStartDate,
          totalDifference,
        });
      }
    } catch (error) {
      console.error("Error verifying previous day EOD:", error);
    } finally {
      setVerifying(false);
    }
  }, []);

  // Trigger verification when date changes (only for single mode)
  useEffect(() => {
    if (mode === 'single' && selectedDate && open) {
      verifyPreviousDayEod(selectedDate);
    } else if (mode === 'range' && dateRange?.from && open) {
      verifyPreviousDayEod(dateRange.from);
    } else {
      setStaleWarning(null);
    }
  }, [selectedDate, dateRange, open, mode, verifyPreviousDayEod]);

  const handleUseSafeStartDate = () => {
    if (staleWarning?.suggestedStartDate) {
      if (mode === 'single') {
        setSelectedDate(staleWarning.suggestedStartDate);
      } else {
        setDateRange({ 
          from: staleWarning.suggestedStartDate, 
          to: dateRange?.to || staleWarning.suggestedStartDate 
        });
      }
    }
  };

  const handleClearSelectedEodData = async () => {
    // Determine date range based on mode
    let fromDate: string, toDate: string, dateLabel: string;
    
    if (mode === 'single') {
      if (!selectedDate) {
        toast.error("Please select a date first");
        return;
      }
      fromDate = toDate = format(selectedDate, "yyyy-MM-dd");
      dateLabel = format(selectedDate, "MMM d, yyyy");
    } else {
      if (!dateRange?.from || !dateRange?.to) {
        toast.error("Please select a date range first");
        return;
      }
      fromDate = format(dateRange.from, "yyyy-MM-dd");
      toDate = format(dateRange.to, "yyyy-MM-dd");
      dateLabel = `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`;
    }

    if (!confirm(`Clear EOD data for ${dateLabel}? This will delete all snapshots and run history for this period. This cannot be undone.`)) {
      return;
    }

    setClearing(true);
    try {
      const { data, error } = await supabase.rpc("clear_eod_by_date_range", {
        p_from_date: fromDate,
        p_to_date: toDate,
      });

      if (error) throw error;

      const result = data as { snapshots_deleted?: number; history_deleted?: number } | null;
      toast.success(
        `EOD cleared for ${dateLabel}`,
        { description: `${result?.snapshots_deleted?.toLocaleString() ?? 0} snapshots, ${result?.history_deleted ?? 0} run records deleted` }
      );
      setStaleWarning(null);
      queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
      onComplete?.();
    } catch (error: any) {
      console.error("Error clearing EOD data:", error);
      toast.error("Failed to clear EOD data", { description: error.message });
    } finally {
      setClearing(false);
    }
  };

  const handleStop = () => {
    setStopRequested(true);
    setStopping(true);
    toast.info("Stopping after current day completes...");
  };

  const runSingleDayEod = async (date: Date): Promise<DayResult> => {
    const dateStr = format(date, "yyyy-MM-dd");
    
    try {
      const { data, error } = await rpcWithRetry<BatchEodResult>(
        "run_batch_eod",
        {
          p_eod_date: dateStr,
          p_skip_existing: skipExisting,
        },
        { maxRetries: 1 }
      );

      if (error) {
        return {
          date: dateStr,
          success: false,
          error: formatRpcError(error),
        };
      }

      if (!data?.success) {
        // Build detailed error message from RPC response
        const errorParts: string[] = [];
        if (data?.error) errorParts.push(data.error);
        if (data?.error_detail) errorParts.push(`(${data.error_detail})`);
        if (data?.errors?.length) errorParts.push(...data.errors.slice(0, 3));
        
        return {
          date: dateStr,
          success: false,
          error: errorParts.length > 0 ? errorParts.join(" ") : "Unknown error - check database logs",
        };
      }

      return {
        date: dateStr,
        success: true,
        skipped: data.skipped,
        clients: data.clients_captured,
        tradeFiles: data.trade_files_count,
        depositRecords: data.deposit_records_count,
        grossBuy: data.gross_buy,
        grossSell: data.gross_sell,
      };
    } catch (error: any) {
      return {
        date: dateStr,
        success: false,
        error: error.message || "Unknown error",
      };
    }
  };

  const runEod = async () => {
    // Validate inputs
    if (mode === 'single' && !selectedDate) {
      toast.error("Please select a date");
      return;
    }
    if (mode === 'range' && (!dateRange?.from || !dateRange?.to)) {
      toast.error("Please select a date range");
      return;
    }

    // Get dates to process
    let datesToProcess: Date[] = [];
    if (mode === 'single') {
      datesToProcess = [selectedDate!];
    } else {
      const days = differenceInDays(dateRange!.to!, dateRange!.from!);
      if (days > MAX_RANGE_DAYS) {
        toast.error(`Maximum range is ${MAX_RANGE_DAYS} days`);
        return;
      }
      datesToProcess = eachDayOfInterval({ start: dateRange!.from!, end: dateRange!.to! });
    }

    setTotalDays(datesToProcess.length);
    setProcessedDays(0);
    setProgress(0);
    setRunning(true);
    setStopRequested(false);
    setStopping(false);
    setDayResults([]);

    const results: DayResult[] = [];
    
    toast.info(`Running EOD for ${datesToProcess.length} day(s)...`);

    for (let i = 0; i < datesToProcess.length; i++) {
      // Check for stop request
      if (stopRequested) {
        toast.info("EOD run stopped by user");
        break;
      }

      const date = datesToProcess[i];
      const dateStr = format(date, "yyyy-MM-dd");
      setCurrentDateProcessing(`Processing ${dateStr} (${i + 1}/${datesToProcess.length})...`);

      const result = await runSingleDayEod(date);
      results.push(result);
      setDayResults([...results]);

      if (!result.success && !result.skipped) {
        toast.error(`EOD failed for ${dateStr}`, { 
          description: result.error,
          duration: 10000,
        });
        break;
      }

      setProcessedDays(i + 1);
      setProgress(((i + 1) / datesToProcess.length) * 100);
    }

    // Summary
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;
    const totalClients = results.reduce((sum, r) => sum + (r.clients || 0), 0);

    if (failedCount === 0) {
      toast.success(`EOD complete: ${successCount} processed, ${skippedCount} skipped`, {
        description: `${totalClients.toLocaleString()} total clients`,
      });
    }

    // Invalidate EOD history cache
    queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });

    setRunning(false);
    setStopping(false);
    setProgress(100);
    setCurrentDateProcessing("");
    
    if (results.length > 1) {
      setShowResultDetails(true);
    } else if (failedCount === 0) {
      setOpen(false);
      onComplete?.();
    }
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const rangeValidation = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return null;
    const days = differenceInDays(dateRange.to, dateRange.from) + 1;
    if (days > MAX_RANGE_DAYS) {
      return { valid: false, message: `Range exceeds ${MAX_RANGE_DAYS} days (${days} selected)` };
    }
    return { valid: true, message: `${days} day(s) selected` };
  }, [dateRange]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-2">
            <Play className="h-4 w-4" />
            Run EOD
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Run End-of-Day (EOD)</DialogTitle>
            <DialogDescription>
              Calculate EOD balances for one or more dates sequentially.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Mode Selector */}
            <Tabs value={mode} onValueChange={(v) => setMode(v as EodMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="single" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  Single Day
                </TabsTrigger>
                <TabsTrigger value="range" className="gap-2">
                  <CalendarRange className="h-4 w-4" />
                  Date Range
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Warning - only show when not skipping existing */}
            {!skipExisting && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <p className="text-sm text-amber-700">
                  This will delete existing EOD data for selected date(s) and recalculate.
                </p>
              </div>
            )}

            {/* Stale Data Warning */}
            {staleWarning && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div className="text-sm space-y-2">
                  <p className="font-medium text-destructive">Stale EOD Data Detected!</p>
                  <p className="text-destructive/80">
                    Previous day ({staleWarning.date}) has <strong>{staleWarning.mismatchCount}</strong> clients 
                    with mismatched balances.
                  </p>
                  <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded font-mono">
                    Total Difference: {formatCurrency(staleWarning.totalDifference)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowMismatchDetails(true)}
                      className="gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      View Details
                    </Button>
                    {mode === 'single' && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setSelectedDate(parse(staleWarning.date, 'yyyy-MM-dd', new Date()))}
                        className="gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Re-run: {staleWarning.date}
                      </Button>
                    )}
                    {staleWarning.suggestedStartDate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleUseSafeStartDate}
                        className="gap-1 text-xs"
                      >
                        Rebuild From: {format(staleWarning.suggestedStartDate, "dd MMM yyyy")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Verification Status */}
            {verifying && (
              <div className="flex items-center gap-2 p-3 bg-muted/50 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Verifying previous day EOD data...</p>
              </div>
            )}

            {/* Verified OK Status */}
            {!verifying && !staleWarning && ((mode === 'single' && selectedDate) || (mode === 'range' && dateRange?.from)) && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                <ShieldCheck className="h-4 w-4 text-green-600" />
                <p className="text-sm text-green-700">Previous day EOD data verified OK</p>
              </div>
            )}

            {/* Date Picker - Single Mode */}
            {mode === 'single' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                      disabled={running}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "yyyy-MM-dd (EEEE)") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Date Picker - Range Mode */}
            {mode === 'range' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Date Range</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dateRange?.from && "text-muted-foreground"
                      )}
                      disabled={running}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yyyy")}
                          </>
                        ) : (
                          format(dateRange.from, "yyyy-MM-dd")
                        )
                      ) : (
                        "Select date range"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                {rangeValidation && (
                  <p className={cn(
                    "text-xs",
                    rangeValidation.valid ? "text-muted-foreground" : "text-destructive"
                  )}>
                    {rangeValidation.message}
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              💡 If you imported a baseline (e.g. Jan 12), run EOD starting from the <em>next</em> day (Jan 13). Running on the baseline date will overwrite it.
            </p>

            {/* Skip Existing Option */}
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="skip-existing" 
                checked={skipExisting}
                onCheckedChange={(checked) => setSkipExisting(checked === true)}
                disabled={running}
              />
              <Label htmlFor="skip-existing" className="text-sm cursor-pointer">
                Skip if EOD already exists for a date
              </Label>
            </div>

            {/* Date Confirmation */}
            {!running && (
              <>
                {mode === 'single' && selectedDate && (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                    <p className="text-sm font-medium text-center">
                      Running EOD for: <span className="text-primary font-mono">{format(selectedDate, "yyyy-MM-dd")}</span>
                    </p>
                  </div>
                )}
                {mode === 'range' && dateRange?.from && dateRange?.to && rangeValidation?.valid && (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                    <p className="text-sm font-medium text-center">
                      Running EOD for: <span className="text-primary font-mono">
                        {format(dateRange.from, "yyyy-MM-dd")} → {format(dateRange.to, "yyyy-MM-dd")}
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}

            {running && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{currentDateProcessing}</span>
                  <span className="text-muted-foreground">{processedDays}/{totalDays}</span>
                </div>
                <Progress value={progress} className="h-2" />
                {dayResults.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    ✓ {dayResults.filter(r => r.success && !r.skipped).length} processed | 
                    ⊘ {dayResults.filter(r => r.skipped).length} skipped |
                    ✗ {dayResults.filter(r => !r.success).length} failed
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="destructive" 
              onClick={handleClearSelectedEodData} 
              disabled={
                running || clearing ||
                (mode === 'single' && !selectedDate) ||
                (mode === 'range' && (!dateRange?.from || !dateRange?.to))
              }
              className="sm:mr-auto"
            >
              {clearing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Selected
                </>
              )}
            </Button>
            
            {running ? (
              <Button variant="outline" onClick={handleStop} disabled={stopping}>
                {stopping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </>
                )}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setOpen(false)} disabled={clearing}>
                Cancel
              </Button>
            )}
            
            <Button 
              onClick={runEod} 
              disabled={
                running || clearing || 
                (mode === 'single' && !selectedDate) ||
                (mode === 'range' && (!dateRange?.from || !dateRange?.to || !rangeValidation?.valid))
              }
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run EOD
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mismatch Details Sheet */}
      <Sheet open={showMismatchDetails} onOpenChange={setShowMismatchDetails}>
        <SheetContent className="sm:max-w-[900px] w-full">
          <SheetHeader>
            <SheetTitle>Mismatched Balances for {staleWarning?.date}</SheetTitle>
            <SheetDescription>
              {staleWarning?.mismatchCount} clients with discrepancies • Total Difference: {formatCurrency(staleWarning?.totalDifference || 0)}
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-4 space-y-4">
            {/* Search and Export */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search investor code..."
                  value={mismatchSearch}
                  onChange={(e) => setMismatchSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" onClick={exportMismatchesToCsv} className="gap-2">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>

            {/* Mismatch Table */}
            <ScrollArea className="h-[calc(100vh-220px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button variant="ghost" size="sm" className="gap-1 -ml-3" onClick={() => handleSort('investorCode')}>
                        Investor Code
                        <ArrowUpDown className="h-3 w-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleSort('storedBalance')}>
                        Stored
                        <ArrowUpDown className="h-3 w-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleSort('expectedBalance')}>
                        Expected
                        <ArrowUpDown className="h-3 w-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleSort('difference')}>
                        Difference
                        <ArrowUpDown className="h-3 w-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Buys</TableHead>
                    <TableHead className="text-right">Sells</TableHead>
                    <TableHead className="text-right">Deposits</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMismatches.map((m) => (
                    <TableRow key={m.investorCode}>
                      <TableCell className="font-mono text-sm">{m.investorCode}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(m.storedBalance)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(m.expectedBalance)}</TableCell>
                      <TableCell className={cn(
                        "text-right font-mono text-sm font-medium",
                        m.difference > 0 ? "text-green-600" : "text-destructive"
                      )}>
                        {m.difference > 0 ? '+' : ''}{formatCurrency(m.difference)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(m.baseBalance)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(m.totalBuys)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(m.totalSells)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(m.deposits)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(m.withdrawals)}</TableCell>
                    </TableRow>
                  ))}
                  {filteredMismatches.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {mismatchSearch ? 'No matching investor codes found' : 'No mismatches to display'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* Batch Results Sheet */}
      <Sheet open={showResultDetails} onOpenChange={setShowResultDetails}>
        <SheetContent className="sm:max-w-[700px] w-full">
          <SheetHeader>
            <SheetTitle>EOD Run Results</SheetTitle>
            <SheetDescription>
              {dayResults.filter(r => r.success && !r.skipped).length} processed, {dayResults.filter(r => r.skipped).length} skipped, {dayResults.filter(r => !r.success).length} failed
            </SheetDescription>
          </SheetHeader>
          
          <ScrollArea className="h-[calc(100vh-180px)] mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Trade Files</TableHead>
                  <TableHead className="text-right">Deposits</TableHead>
                  <TableHead className="text-right">Gross Buy</TableHead>
                  <TableHead className="text-right">Gross Sell</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayResults.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="font-mono text-sm">{r.date}</TableCell>
                    <TableCell>
                      {r.success ? (
                        r.skipped ? (
                          <span className="text-muted-foreground">Skipped</span>
                        ) : (
                          <span className="text-green-600">✓ OK</span>
                        )
                      ) : (
                        <span className="text-destructive">✗ {r.error}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.clients?.toLocaleString() || '-'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.tradeFiles ?? '-'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.depositRecords ?? '-'}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {r.grossBuy ? formatCurrency(r.grossBuy) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {r.grossSell ? formatCurrency(r.grossSell) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          
          <div className="mt-4 flex justify-end">
            <Button onClick={() => { setShowResultDetails(false); setOpen(false); onComplete?.(); }}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
