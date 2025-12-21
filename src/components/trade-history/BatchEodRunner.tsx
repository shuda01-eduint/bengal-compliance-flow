import { useState } from "react";
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
import { CalendarIcon, Loader2, Play, AlertTriangle } from "lucide-react";
import { format, addDays, differenceInDays } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface BatchEodRunnerProps {
  onComplete?: () => void;
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

      // 2. Fetch all clients (base list with initial ledger balances)
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("inv_code, investor_name, ledger_balance, rm_email");

      if (clientsError) throw clientsError;

      if (!clients || clients.length === 0) {
        toast.warning("No client data found");
        return;
      }

      // 3. Fetch investor commission rates
      const { data: investorData } = await supabase
        .from("investors")
        .select("investor_code, brokerage_commission");

      const commissionMap = new Map<string, number>();
      investorData?.forEach((inv) => {
        commissionMap.set(inv.investor_code.toUpperCase(), inv.brokerage_commission || 0);
      });

      // 4. For the first date, get the previous day's EOD (day before start date)
      const dayBeforeStart = format(addDays(startDate, -1), "yyyy-MM-dd");
      const { data: prevDayEod } = await supabase
        .from("eod_ledger_snapshots")
        .select("investor_code, ledger_balance")
        .eq("eod_date", dayBeforeStart);

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
        // Default to client's ledger_balance from the clients table
        runningBalances.set(client.inv_code, client.ledger_balance || 0);
      });

      // Override with previous day EOD if exists
      prevDayEod?.forEach((row) => {
        runningBalances.set(row.investor_code, row.ledger_balance || 0);
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
            const current = txMap.get(tx.investor_code) || { deposits: 0, withdrawals: 0 };
            if (tx.transaction_type.toLowerCase().includes("deposit")) {
              current.deposits += tx.amount || 0;
              totalDeposits += tx.amount || 0;
            } else {
              current.withdrawals += tx.amount || 0;
              totalWithdrawals += tx.amount || 0;
            }
            txMap.set(tx.investor_code, current);
          });
        }

        // Get day's trades
        const { data: dateTrades } = await supabase
          .from("trade_history")
          .select("client_code, side, value, fill_type, status")
          .eq("trade_date", tradeDateFormatted);

        const tradeMap = new Map<string, { grossBuys: number; netSells: number }>();
        let tradeFilesCount = 0;

        if (dateTrades) {
          tradeFilesCount = dateTrades.length > 0 ? 1 : 0;
          dateTrades.forEach((trade) => {
            if (!trade.client_code || !trade.value) return;

            const fillType = (trade.fill_type || trade.status || "").toUpperCase();
            if (!["FILL", "PF"].includes(fillType)) return;

            const clientCode = trade.client_code.toUpperCase();
            const commissionRate = commissionMap.get(clientCode) || 0;
            const current = tradeMap.get(trade.client_code) || { grossBuys: 0, netSells: 0 };
            const side = (trade.side || "").toUpperCase();

            if (side === "BUY" || side === "B") {
              current.grossBuys += trade.value * (1 + commissionRate);
            } else if (side === "SELL" || side === "S") {
              current.netSells += trade.value * (1 - commissionRate);
            }
            tradeMap.set(trade.client_code, current);
          });
        }

        // Calculate EOD for each client using running balances
        const eodRecords = clients.map((client) => {
          const invCode = client.inv_code;
          const openingBalance = runningBalances.get(invCode) || 0;
          const tx = txMap.get(invCode) || { deposits: 0, withdrawals: 0 };
          const trades = tradeMap.get(invCode) || { grossBuys: 0, netSells: 0 };

          const calculatedBalance =
            openingBalance +
            tx.deposits -
            tx.withdrawals +
            trades.netSells -
            trades.grossBuys;

          // Update running balance for next day
          runningBalances.set(invCode, calculatedBalance);

          return {
            eod_date: dateStr,
            investor_code: invCode,
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

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={runBatchEod} disabled={running || !startDate || !endDate}>
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
