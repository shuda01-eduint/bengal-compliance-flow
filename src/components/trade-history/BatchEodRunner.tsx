import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarIcon, Loader2, Play, AlertTriangle, ShieldCheck, RefreshCw, Trash2 } from "lucide-react";
import { format, addDays, differenceInDays, parse } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface BatchEodRunnerProps {
  onComplete?: () => void;
}

interface StaleWarning {
  date: string;
  mismatchCount: number;
  sampleClient: string;
  storedValue: number;
  expectedValue: number;
  suggestedStartDate: Date | null;
}

// Helper function to fetch all rows with pagination (Supabase limits to 1000)
async function fetchAllRows<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const result = await queryFn(from, to);
    const { data, error } = result;

    if (error) throw error;
    if (data) allData = [...allData, ...data];
    hasMore = data?.length === PAGE_SIZE;
    page++;
  }

  return allData;
}

export const BatchEodRunner = ({ onComplete }: BatchEodRunnerProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDateProcessing, setCurrentDateProcessing] = useState<string>("");
  const [processedDays, setProcessedDays] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [staleWarning, setStaleWarning] = useState<StaleWarning | null>(null);
  const [clearing, setClearing] = useState(false);

  // Verify previous day EOD when start date changes
  const verifyPreviousDayEod = useCallback(async (selectedStartDate: Date) => {
    setVerifying(true);
    setStaleWarning(null);

    try {
      const prevDay = format(addDays(selectedStartDate, -1), "yyyy-MM-dd");
      const twoDaysBefore = format(addDays(selectedStartDate, -2), "yyyy-MM-dd");
      const prevDayTradeFormat = format(addDays(selectedStartDate, -1), "yyyyMMdd");

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

      // Calculate expected EOD for each client
      const expectedBalances = new Map<string, number>();

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

      // Calculate expected balance for each client
      baseBalances.forEach((baseBalance, invCode) => {
        const tx = txMap.get(invCode) || { deposits: 0, withdrawals: 0 };
        const trades = tradeMap.get(invCode) || { grossBuys: 0, netSells: 0 };
        const expectedBalance = baseBalance + tx.deposits - tx.withdrawals + trades.netSells - trades.grossBuys;
        expectedBalances.set(invCode, expectedBalance);
      });

      // Compare stored vs expected
      const mismatches: { code: string; stored: number; expected: number }[] = [];
      const TOLERANCE = 0.01; // Allow 1 paisa difference

      storedEod.forEach((row) => {
        const code = row.investor_code.toUpperCase();
        const expected = expectedBalances.get(code);
        if (expected !== undefined) {
          const diff = Math.abs(row.ledger_balance - expected);
          if (diff > TOLERANCE) {
            mismatches.push({
              code: row.investor_code,
              stored: row.ledger_balance,
              expected: expected,
            });
          }
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

        const sample = mismatches[0];
        setStaleWarning({
          date: prevDay,
          mismatchCount: mismatches.length,
          sampleClient: sample.code,
          storedValue: sample.stored,
          expectedValue: sample.expected,
          suggestedStartDate,
        });
      }
    } catch (error) {
      console.error("Error verifying previous day EOD:", error);
    } finally {
      setVerifying(false);
    }
  }, []);

  // Trigger verification when start date changes
  useEffect(() => {
    if (startDate && open) {
      verifyPreviousDayEod(startDate);
    } else {
      setStaleWarning(null);
    }
  }, [startDate, open, verifyPreviousDayEod]);

  const handleUseSafeStartDate = () => {
    if (staleWarning?.suggestedStartDate) {
      setStartDate(staleWarning.suggestedStartDate);
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

  const runBatchEod = async () => {
    if (!startDate || !endDate) {
      toast.error("Please select both start and end dates");
      return;
    }

    if (startDate > endDate) {
      toast.error("Start date must be before end date");
      return;
    }

    const dayCount = differenceInDays(endDate, startDate) + 1;
    setTotalDays(dayCount);
    setProcessedDays(0);
    setProgress(0);
    setRunning(true);

    try {
      // 1. Delete existing EOD snapshots from start date onwards
      const startDateStr = format(startDate, "yyyy-MM-dd");
      toast.info(`Clearing EOD snapshots from ${startDateStr} onwards...`);
      
      const { error: deleteError } = await supabase
        .from("eod_ledger_snapshots")
        .delete()
        .gte("eod_date", startDateStr);

      if (deleteError) throw deleteError;

      // Also delete EOD run history from start date onwards
      await supabase
        .from("eod_run_history")
        .delete()
        .gte("run_date", startDateStr);

      // 2. Fetch ALL clients using pagination (Supabase limits to 1000)
      toast.info("Fetching all clients...");
      const clients = await fetchAllRows<{
        inv_code: string;
        investor_name: string;
        ledger_balance: number;
        rm_email: string | null;
      }>((from, to) =>
        supabase
          .from("clients")
          .select("inv_code, investor_name, ledger_balance, rm_email")
          .range(from, to)
      );

      if (!clients || clients.length === 0) {
        toast.warning("No client data found");
        setRunning(false);
        return;
      }

      toast.info(`Loaded ${clients.length} clients`);

      // 3. Fetch ALL investor commission rates using pagination
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

      // 4. For the first date, get the previous day's EOD (day before start date) with pagination
      const dayBeforeStart = format(addDays(startDate, -1), "yyyy-MM-dd");
      const prevDayEod = await fetchAllRows<{
        investor_code: string;
        ledger_balance: number;
      }>((from, to) =>
        supabase
          .from("eod_ledger_snapshots")
          .select("investor_code, ledger_balance")
          .eq("eod_date", dayBeforeStart)
          .range(from, to)
      );

      // Check if we need previous day EOD - find earliest trade date
      const { data: earliestTrade } = await supabase
        .from("trade_history")
        .select("trade_date")
        .order("trade_date", { ascending: true })
        .limit(1);

      const earliestTradeDate = earliestTrade?.[0]?.trade_date;
      const startDateFormatted = format(startDate, "yyyyMMdd");

      // If we're starting after the earliest trade date, we MUST have previous day EOD
      if (earliestTradeDate && startDateFormatted > earliestTradeDate) {
        if (!prevDayEod || prevDayEod.length === 0) {
          toast.error(`No EOD data for ${dayBeforeStart}`, {
            description: "Please run batch EOD from an earlier date first.",
          });
          setRunning(false);
          return;
        }
      }

      // Create initial balance map (from day before start, or from clients.ledger_balance)
      let runningBalances = new Map<string, number>();
      clients.forEach((client) => {
        // Default to client's ledger_balance from the clients table - normalize to uppercase
        runningBalances.set(client.inv_code.toUpperCase(), client.ledger_balance || 0);
      });

      // Override with previous day EOD if exists
      prevDayEod?.forEach((row) => {
        runningBalances.set(row.investor_code.toUpperCase(), row.ledger_balance || 0);
      });

      // 5. Process each day sequentially
      let currentDate = new Date(startDate);
      let daysProcessed = 0;

      while (currentDate <= endDate) {
        const dateStr = format(currentDate, "yyyy-MM-dd");
        const tradeDateFormatted = format(currentDate, "yyyyMMdd");
        setCurrentDateProcessing(dateStr);

        // Get day's deposits/withdrawals
        const { data: dateTx } = await supabase
          .from("deposits_withdrawals")
          .select("investor_code, amount, transaction_type")
          .eq("transaction_date", dateStr);

        const txMap = new Map<string, { deposits: number; withdrawals: number }>();
        let totalDeposits = 0;
        let totalWithdrawals = 0;
        let depositRecordsCount = 0;

        if (dateTx) {
          depositRecordsCount = dateTx.length;
          dateTx.forEach((tx) => {
            const investorCode = tx.investor_code.toUpperCase(); // Normalize to uppercase
            const current = txMap.get(investorCode) || { deposits: 0, withdrawals: 0 };
            if (tx.transaction_type.toLowerCase().includes("deposit")) {
              current.deposits += tx.amount || 0;
              totalDeposits += tx.amount || 0;
            } else {
              current.withdrawals += tx.amount || 0;
              totalWithdrawals += tx.amount || 0;
            }
            txMap.set(investorCode, current);
          });
        }

        // Get day's trades
        const { data: dateTrades } = await supabase
          .from("trade_history")
          .select("client_code, side, value, fill_type, status")
          .eq("trade_date", tradeDateFormatted);

        const tradeMap = new Map<string, { grossBuys: number; netSells: number }>();
        let tradeFilesCount = 0;

        // DEBUG: Log trade count for this date
        console.log(`[EOD ${dateStr}] Found ${dateTrades?.length || 0} trades`);

        if (dateTrades) {
          tradeFilesCount = dateTrades.length > 0 ? 1 : 0;
          dateTrades.forEach((trade) => {
            if (!trade.client_code || !trade.value) return;

            const fillType = (trade.fill_type || trade.status || "").toUpperCase();
            if (!["FILL", "PF"].includes(fillType)) return;

            const clientCode = trade.client_code.toUpperCase(); // Normalize to uppercase
            const commissionRate = commissionMap.get(clientCode) || 0;
            const current = tradeMap.get(clientCode) || { grossBuys: 0, netSells: 0 };
            const side = (trade.side || "").toUpperCase();

            // DEBUG: Log trade details for OBO4083
            if (clientCode === "OBO4083") {
              console.log(`[EOD ${dateStr}] OBO4083 Trade:`, {
                side,
                value: trade.value,
                commissionRate,
                fillType,
                grossWithComm: side === "BUY" || side === "B" ? trade.value * (1 + commissionRate) : 0,
                netWithComm: side === "SELL" || side === "S" ? trade.value * (1 - commissionRate) : 0,
              });
            }

            if (side === "BUY" || side === "B") {
              current.grossBuys += trade.value * (1 + commissionRate);
            } else if (side === "SELL" || side === "S") {
              current.netSells += trade.value * (1 - commissionRate);
            }
            tradeMap.set(clientCode, current); // Store with normalized key
          });
        }

        // Calculate EOD for each client using running balances
        const eodRecords = clients.map((client) => {
          const invCodeUpper = client.inv_code.toUpperCase(); // Normalize to uppercase for lookups
          const openingBalance = runningBalances.get(invCodeUpper) || 0;
          const tx = txMap.get(invCodeUpper) || { deposits: 0, withdrawals: 0 };
          const trades = tradeMap.get(invCodeUpper) || { grossBuys: 0, netSells: 0 };

          const calculatedBalance =
            openingBalance +
            tx.deposits -
            tx.withdrawals +
            trades.netSells -
            trades.grossBuys;

          // DEBUG: Log calculation for OBO4083
          if (invCodeUpper === "OBO4083") {
            console.log(`[EOD ${dateStr}] OBO4083 Calculation:`, {
              openingBalance,
              deposits: tx.deposits,
              withdrawals: tx.withdrawals,
              grossBuys: trades.grossBuys,
              netSells: trades.netSells,
              calculatedBalance,
              formula: `${openingBalance} + ${tx.deposits} - ${tx.withdrawals} + ${trades.netSells} - ${trades.grossBuys} = ${calculatedBalance}`,
            });
          }

          // Update running balance for next day (use uppercase key)
          runningBalances.set(invCodeUpper, calculatedBalance);

          return {
            eod_date: dateStr,
            investor_code: client.inv_code, // Store original case in DB
            investor_name: client.investor_name,
            ledger_balance: calculatedBalance,
            rm_email: client.rm_email,
            created_by: user?.id,
          };
        });

        // Upsert EOD records
        const BATCH_SIZE = 500;
        for (let i = 0; i < eodRecords.length; i += BATCH_SIZE) {
          const batch = eodRecords.slice(i, i + BATCH_SIZE);
          const { error } = await supabase
            .from("eod_ledger_snapshots")
            .upsert(batch, { onConflict: "eod_date,investor_code" });

          if (error) throw error;
        }

        // Record EOD run history
        const totalLedgerBalance = eodRecords.reduce((sum, r) => sum + r.ledger_balance, 0);
        await supabase.from("eod_run_history").insert({
          run_date: dateStr,
          run_by: user?.id,
          run_by_email: user?.email,
          clients_captured: eodRecords.length,
          total_ledger_balance: totalLedgerBalance,
          trade_files_count: tradeFilesCount,
          deposit_records_count: depositRecordsCount,
          total_deposits: totalDeposits,
          total_withdrawals: totalWithdrawals,
          status: "completed",
        });

        // Update progress
        daysProcessed++;
        setProcessedDays(daysProcessed);
        setProgress((daysProcessed / dayCount) * 100);

        // Move to next day
        currentDate = addDays(currentDate, 1);

        // Yield to UI
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      toast.success(`Batch EOD complete: ${daysProcessed} days processed`, {
        description: `From ${format(startDate, "dd MMM")} to ${format(endDate, "dd MMM yyyy")}`,
      });

      setOpen(false);
      onComplete?.();
    } catch (error: any) {
      console.error("Batch EOD error:", error);
      toast.error("Batch EOD failed", { description: error.message });
    } finally {
      setRunning(false);
      setProgress(0);
      setCurrentDateProcessing("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Play className="h-4 w-4" />
          Batch EOD
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Run Batch EOD</DialogTitle>
          <DialogDescription>
            Calculate EOD balances sequentially for a date range. This will delete and
            recalculate all EOD snapshots from the start date onwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-700">
              This will delete existing EOD data from the start date and recalculate using
              commission-adjusted trades.
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
                  Example: {staleWarning.sampleClient}<br />
                  Stored: {staleWarning.storedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}<br />
                  Expected: {staleWarning.expectedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <p className="text-amber-600 font-medium">
                  Run from an earlier date to recalculate properly.
                </p>
                {staleWarning.suggestedStartDate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUseSafeStartDate}
                    className="gap-2 mt-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Use Safe Start: {format(staleWarning.suggestedStartDate, "dd MMM yyyy")}
                  </Button>
                )}
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
          {!verifying && !staleWarning && startDate && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <p className="text-sm text-green-700">Previous day EOD data verified OK</p>
            </div>
          )}

          {/* Date Pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                    disabled={running}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "dd MMM yyyy") : "Select"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                    disabled={running}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "dd MMM yyyy") : "Select"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={(date) => startDate ? date < startDate : false}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Progress */}
          {running && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Processing: {currentDateProcessing}</span>
                <span className="font-medium">{processedDays} / {totalDays} days</span>
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
          <Button onClick={runBatchEod} disabled={running || clearing || !startDate || !endDate}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Batch EOD
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
