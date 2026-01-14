import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarIcon, Loader2, Play, AlertTriangle, ShieldCheck, RefreshCw, Trash2, Search, Download, Eye, ArrowUpDown } from "lucide-react";
import { format, addDays, parse } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/supabase-utils";

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
  days_processed?: number;
  total_snapshots?: number;
  start_date?: string;
  end_date?: string;
  error?: string;
}

type SortField = 'investorCode' | 'storedBalance' | 'expectedBalance' | 'difference';
type SortDirection = 'asc' | 'desc';

export const BatchEodRunner = ({ onComplete }: BatchEodRunnerProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDateProcessing, setCurrentDateProcessing] = useState<string>("");
  const [processedDays, setProcessedDays] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [staleWarning, setStaleWarning] = useState<StaleWarning | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showMismatchDetails, setShowMismatchDetails] = useState(false);
  const [mismatchSearch, setMismatchSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>('difference');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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

      // If no base EOD, use clients.ledger_balance
      const clients = await fetchAllRows<{
        inv_code: string;
        ledger_balance: number;
      }>((from, to) =>
        supabase
          .from("clients")
          .select("inv_code, ledger_balance")
          .range(from, to)
      );

      // Fetch commission rates
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
        commissionMap.set(inv.investor_code.toUpperCase(), inv.brokerage_commission || 0);
      });

      // Build base balance map
      const baseBalances = new Map<string, number>();
      clients?.forEach((c) => {
        baseBalances.set(c.inv_code.toUpperCase(), c.ledger_balance || 0);
      });
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

      // Process trades
      const tradeMap = new Map<string, { grossBuys: number; netSells: number }>();
      prevDayTrades?.forEach((trade) => {
        if (!trade.client_code || !trade.value) return;
        const fillType = (trade.fill_type || trade.status || "").toUpperCase();
        if (!["FILL", "PF"].includes(fillType)) return;

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

  // Trigger verification when date changes
  useEffect(() => {
    if (selectedDate && open) {
      verifyPreviousDayEod(selectedDate);
    } else {
      setStaleWarning(null);
    }
  }, [selectedDate, open, verifyPreviousDayEod]);

  const handleUseSafeStartDate = () => {
    if (staleWarning?.suggestedStartDate) {
      setSelectedDate(staleWarning.suggestedStartDate);
    }
  };

  const handleClearAllEodData = async () => {
    if (!confirm("Are you sure you want to clear ALL EOD data? This cannot be undone.")) {
      return;
    }

    setClearing(true);
    try {
      // Clear eod_ledger_snapshots
      const { error: snapshotError } = await supabase
        .from("eod_ledger_snapshots")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

      if (snapshotError) throw snapshotError;

      // Clear eod_run_history
      const { error: historyError } = await supabase
        .from("eod_run_history")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

      if (historyError) throw historyError;

      toast.success("All EOD data cleared successfully");
      setStaleWarning(null);
      onComplete?.();
    } catch (error: any) {
      console.error("Error clearing EOD data:", error);
      toast.error("Failed to clear EOD data", { description: error.message });
    } finally {
      setClearing(false);
    }
  };

  const runEod = async () => {
    if (!selectedDate) {
      toast.error("Please select a date");
      return;
    }

    setTotalDays(1);
    setProcessedDays(0);
    setProgress(0);
    setRunning(true);

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    setCurrentDateProcessing(`Processing ${dateStr}...`);

    toast.info(`Running EOD for ${dateStr}...`);

    let totalClientsProcessed = 0;

    try {
      const { data, error } = await supabase.rpc("run_batch_eod", {
        p_start_date: dateStr,
        p_end_date: dateStr,
      });

      if (error) {
        toast.error("EOD failed", { description: error.message });
        return;
      }

      const result = data as unknown as BatchEodResult;

      if (!result.success) {
        toast.error("EOD failed", { description: result.error || "Unknown error" });
        return;
      }

      totalClientsProcessed = result.total_snapshots || 0;
      setProcessedDays(1);
      setProgress(100);

      toast.success(`EOD complete for ${dateStr}`, {
        description: `${totalClientsProcessed.toLocaleString()} clients processed`,
      });

      // Invalidate EOD history cache so the table refreshes immediately
      queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });

      setOpen(false);
      onComplete?.();
    } catch (error: any) {
      console.error("EOD error:", error);
      toast.error("EOD failed", { description: error.message });
    } finally {
      setRunning(false);
      setProgress(0);
      setCurrentDateProcessing("");
    }
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-2">
            <Play className="h-4 w-4" />
            Run EOD
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Run EOD for Single Day</DialogTitle>
            <DialogDescription>
              Calculate EOD balances for a specific date. Run one day at a time sequentially.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Warning */}
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
              <p className="text-sm text-amber-700">
                This will delete existing EOD data for the selected date and recalculate.
              </p>
            </div>
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
                    {staleWarning.suggestedStartDate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUseSafeStartDate}
                        className="gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Use Safe Start: {format(staleWarning.suggestedStartDate, "dd MMM yyyy")}
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
            {!verifying && !staleWarning && selectedDate && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                <ShieldCheck className="h-4 w-4 text-green-600" />
                <p className="text-sm text-green-700">Previous day EOD data verified OK</p>
              </div>
            )}

            {/* Date Picker */}
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

            {/* Date Confirmation */}
            {selectedDate && !running && (
              <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                <p className="text-sm font-medium text-center">
                  Running EOD for: <span className="text-primary font-mono">{format(selectedDate, "yyyy-MM-dd")}</span>
                </p>
              </div>
            )}

            {running && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{currentDateProcessing}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="destructive" 
              onClick={handleClearAllEodData} 
              disabled={running || clearing}
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
                  Clear All EOD Data
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={running || clearing}>
              Cancel
            </Button>
            <Button onClick={runEod} disabled={running || clearing || !selectedDate}>
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
    </>
  );
};
