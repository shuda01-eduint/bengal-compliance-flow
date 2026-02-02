import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, eachDayOfInterval } from "date-fns";
import { rpcWithRetry, formatRpcError } from "@/lib/rpc-utils";
import type { DateRange } from "react-day-picker";
import { AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { EodDateSelector, type EodMode } from "@/components/eod/EodDateSelector";
import { EodStatusDashboard } from "@/components/eod/EodStatusDashboard";
import { EodActionButtons } from "@/components/eod/EodActionButtons";
import { EodSummaryCards } from "@/components/eod/EodSummaryCards";
import { EodLogTable } from "@/components/eod/EodLogTable";
import { EodProgressBar } from "@/components/eod/EodProgressBar";
import { DseTradeImportDialog } from "@/components/eod/DseTradeImportDialog";
import { CseTradeImportDialog } from "@/components/eod/CseTradeImportDialog";
import { DepositsImportDialog } from "@/components/eod/DepositsImportDialog";
import { SettlementCalculationDialog } from "@/components/eod/SettlementCalculationDialog";
import { useEodHistoricalData } from "@/hooks/useEodHistoricalData";
import { useEodStagingSummary } from "@/hooks/useEodStagingSummary";
import { useUnmatchedStagingData, hasSignificantUnmatchedData } from "@/hooks/useUnmatchedStagingData";
import { UserPlus } from "lucide-react";

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
}

interface DayResult {
  date: string;
  success: boolean;
  skipped?: boolean;
  clients?: number;
  tradeFiles?: number;
  grossBuy?: number;
  grossSell?: number;
  commission?: number;
  deposits?: number;
  withdrawals?: number;
  error?: string;
}

// Process staged trades result interface
interface ProcessStagedResult {
  success: boolean;
  trade_date?: string;
  trade_count?: number;
  investor_count?: number;
  gross_buy?: number;
  gross_sell?: number;
  total_commission?: number;
  deposit_count?: number;
  withdrawal_count?: number;
  total_deposits?: number;
  total_withdrawals?: number;
  instruments_priced?: number;
  positions_captured?: number;
  total_market_value?: number;
  snapshots_created?: number;
  margin_accounts?: number;
  margin_exposure?: number;
  daily_interest_total?: number;
  cumulative_interest_total?: number;
  total_equity?: number;
  negative_equity_count?: number;
  with_rm_assigned?: number;
  with_department?: number;
  error?: string;
  error_detail?: string;
}

export default function EodPage() {
  const queryClient = useQueryClient();
  
  // Date selection
  const [mode, setMode] = useState<EodMode>("single");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Fetch historical data for selected date
  const { data: historicalData, isLoading: loadingHistorical } = useEodHistoricalData(selectedDate);
  
  // Fetch current staging summary for selected date
  const { data: stagingSummary } = useEodStagingSummary(selectedDate);

  // Fetch unmatched staging data (missing investors)
  const { data: unmatchedData, refetch: refetchUnmatched } = useUnmatchedStagingData(selectedDate);
  const hasUnmatchedData = hasSignificantUnmatchedData(unmatchedData);

  // Auto-create missing investors state
  const [autoCreating, setAutoCreating] = useState(false);

  // Detect if staging data differs from historical data (stale data warning)
  const isDataStale = !!(
    historicalData && 
    stagingSummary && 
    (
      Math.abs((historicalData.total_deposits ?? 0) - stagingSummary.totalDeposits) > 0.01 ||
      Math.abs((historicalData.total_withdrawals ?? 0) - stagingSummary.totalWithdrawals) > 0.01
    )
  );

  // Import dialog state
  const [dseImportDialogOpen, setDseImportDialogOpen] = useState(false);
  const [cseImportDialogOpen, setCseImportDialogOpen] = useState(false);
  const [depositsDialogOpen, setDepositsDialogOpen] = useState(false);
  const [settlementDialogOpen, setSettlementDialogOpen] = useState(false);

  // Processing state
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [processingStaged, setProcessingStaged] = useState(false);

  // Progress tracking
  const [progress, setProgress] = useState(0);
  const [currentDateProcessing, setCurrentDateProcessing] = useState("");
  const [processedDays, setProcessedDays] = useState(0);
  const [totalDays, setTotalDays] = useState(0);

  // Results
  const [dayResults, setDayResults] = useState<DayResult[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [stagedResult, setStagedResult] = useState<ProcessStagedResult | null>(null);

  // Computed status counts
  const completedCount = dayResults.filter((r) => r.success && !r.skipped).length;
  const failedCount = dayResults.filter((r) => !r.success).length;
  const skippedCount = dayResults.filter((r) => r.skipped).length;

  // Aggregated summary
  const summary = dayResults.reduce(
    (acc, r) => ({
      totalTrades: acc.totalTrades + (r.tradeFiles || 0),
      clientsCaptured: acc.clientsCaptured + (r.clients || 0),
      grossBuy: acc.grossBuy + (r.grossBuy || 0),
      grossSell: acc.grossSell + (r.grossSell || 0),
      totalCommission: acc.totalCommission + (r.commission || 0),
      totalDeposits: acc.totalDeposits + (r.deposits || 0),
      totalWithdrawals: acc.totalWithdrawals + (r.withdrawals || 0),
      errorsCount: acc.errorsCount + (r.success ? 0 : 1),
    }),
    {
      totalTrades: 0,
      clientsCaptured: 0,
      grossBuy: 0,
      grossSell: 0,
      totalCommission: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      errorsCount: 0,
    }
  );

  const hasDateSelected =
    mode === "single" ? !!selectedDate : !!(dateRange?.from && dateRange?.to);

  const runSingleDayEod = async (date: Date): Promise<DayResult> => {
    const dateStr = format(date, "yyyy-MM-dd");

    try {
      const { data, error } = await rpcWithRetry<BatchEodResult>(
        "run_batch_eod",
        { p_eod_date: dateStr, p_skip_existing: false },
        { maxRetries: 1 }
      );

      if (error) {
        return { date: dateStr, success: false, error: formatRpcError(error) };
      }

      if (!data?.success) {
        const errorParts: string[] = [];
        if (data?.error) errorParts.push(data.error);
        if (data?.error_detail) errorParts.push(`(${data.error_detail})`);
        return {
          date: dateStr,
          success: false,
          error: errorParts.length > 0 ? errorParts.join(" ") : "Unknown error",
        };
      }

      return {
        date: dateStr,
        success: true,
        skipped: data.skipped,
        clients: data.clients_captured,
        tradeFiles: data.trade_files_count,
        grossBuy: data.gross_buy,
        grossSell: data.gross_sell,
        commission: data.total_commission,
        deposits: data.total_deposits,
        withdrawals: data.total_withdrawals,
      };
    } catch (err: any) {
      return { date: dateStr, success: false, error: err.message };
    }
  };

  const handleRunFullEod = async () => {
    let datesToProcess: Date[] = [];

    if (mode === "single" && selectedDate) {
      datesToProcess = [selectedDate];
    } else if (mode === "range" && dateRange?.from && dateRange?.to) {
      datesToProcess = eachDayOfInterval({
        start: dateRange.from,
        end: dateRange.to,
      });
    }

    if (datesToProcess.length === 0) {
      toast.error("Please select a date or date range");
      return;
    }

    setRunning(true);
    setStopRequested(false);
    setStopping(false);
    setDayResults([]);
    setShowSummary(false);
    setStagedResult(null);  // Clear staged result so batch results show
    setLastError(null);
    setTotalDays(datesToProcess.length);
    setProcessedDays(0);
    setProgress(0);

    const results: DayResult[] = [];

    for (let i = 0; i < datesToProcess.length; i++) {
      if (stopRequested) {
        toast.info("EOD processing stopped by user");
        break;
      }

      const date = datesToProcess[i];
      setCurrentDateProcessing(format(date, "yyyy-MM-dd"));
      setProgress(((i + 1) / datesToProcess.length) * 100);

      const result = await runSingleDayEod(date);
      results.push(result);
      setDayResults([...results]);
      setProcessedDays(i + 1);

      if (!result.success) {
        toast.error(`EOD failed for ${result.date}`, {
          description: result.error,
        });
      }
    }

    setRunning(false);
    setStopping(false);
    setShowSummary(true);
    setCurrentDateProcessing("");
    queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // Track last error for prominent display
    const lastFailure = results.find((r) => !r.success);
    if (lastFailure?.error) {
      setLastError(lastFailure.error);
    }

    if (failCount === 0) {
      toast.success(`EOD completed successfully for ${successCount} day(s)`);
    } else {
      toast.warning(`EOD completed with ${failCount} error(s)`);
    }
  };

  const handleStop = () => {
    setStopRequested(true);
    setStopping(true);
    toast.info("Stopping after current day completes...");
  };

  const handleClearSelected = async () => {
    let fromDate: string, toDate: string, dateLabel: string;

    if (mode === "single") {
      if (!selectedDate) return;
      fromDate = toDate = format(selectedDate, "yyyy-MM-dd");
      dateLabel = format(selectedDate, "MMM d, yyyy");
    } else {
      if (!dateRange?.from || !dateRange?.to) return;
      fromDate = format(dateRange.from, "yyyy-MM-dd");
      toDate = format(dateRange.to, "yyyy-MM-dd");
      dateLabel = `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`;
    }

    if (!confirm(`Clear EOD data for ${dateLabel}? This cannot be undone.`)) {
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
      toast.success(`EOD cleared for ${dateLabel}`, {
        description: `${result?.snapshots_deleted?.toLocaleString() ?? 0} snapshots, ${result?.history_deleted ?? 0} run records deleted`,
      });
      queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
    } catch (error: any) {
      toast.error("Failed to clear EOD data", { description: error.message });
    } finally {
      setClearing(false);
    }
  };

  const handleImportDseTrades = () => {
    setDseImportDialogOpen(true);
  };

  const handleImportCseTrades = () => {
    setCseImportDialogOpen(true);
  };

  const handleImportDeposits = () => {
    setDepositsDialogOpen(true);
  };

  const handleProcessStaged = async () => {
    if (!selectedDate) {
      toast.error("Please select a date first");
      return;
    }

    setProcessingStaged(true);
    setStagedResult(null);
    setDayResults([]); // Clear batch results so staged results show correctly
    setLastError(null);
    
    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const { data, error } = await supabase.rpc("process_staged_trades", {
        p_trade_date: dateStr,
      });

      if (error) throw error;

      const result = data as unknown as ProcessStagedResult;
      setStagedResult(result);

      if (result.success) {
        toast.success(`Processed trades for ${dateStr}`, {
          description: `${result.snapshots_created?.toLocaleString()} snapshots, ${result.positions_captured?.toLocaleString()} positions`,
        });
        setShowSummary(true);
        queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
      } else {
        setLastError(result.error || "Unknown error");
        toast.error("Processing failed", {
          description: result.error,
        });
      }
    } catch (error: any) {
      setLastError(error.message);
      toast.error("Failed to process staged trades", { description: error.message });
    } finally {
      setProcessingStaged(false);
    }
  };

  const handleGenerateReport = () => {
    toast.info("Generate Report - Coming soon");
  };

  const handleAutoCreateMissing = async () => {
    if (!selectedDate) {
      toast.error("Please select a date first");
      return;
    }

    setAutoCreating(true);
    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const { data, error } = await supabase.rpc("auto_create_missing_investors" as any, {
        p_trade_date: dateStr,
      });

      if (error) throw error;

      const result = data as { inserted_count?: number; sample_codes?: string[] } | null;
      if (result?.inserted_count && result.inserted_count > 0) {
        toast.success(`Created ${result.inserted_count} missing investor(s)`, {
          description: `Sample: ${result.sample_codes?.slice(0, 5).join(", ")}...`,
        });
        refetchUnmatched();
        queryClient.invalidateQueries({ queryKey: ["investors"] });
      } else {
        toast.info("No missing investors to create");
      }
    } catch (error: any) {
      toast.error("Failed to create missing investors", { description: error.message });
    } finally {
      setAutoCreating(false);
    }
  };

  return (
    <MainLayout title="EOD Processing" subtitle="Process end-of-day calculations and settlements">
      <div className="space-y-6">

        {/* Date Selector */}
        <EodDateSelector
          mode={mode}
          onModeChange={setMode}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          dateRange={dateRange}
          onRangeChange={setDateRange}
          disabled={running}
        />

        {/* Status Dashboard */}
        <EodStatusDashboard
          pendingCount={totalDays - processedDays}
          runningCount={running ? 1 : 0}
          completedCount={completedCount}
          failedCount={failedCount}
        />

        {/* Action Buttons */}
        <EodActionButtons
          onImportDseTrades={handleImportDseTrades}
          onImportCseTrades={handleImportCseTrades}
          onImportDeposits={handleImportDeposits}
          onProcessStaged={handleProcessStaged}
          onCalculateSettlements={() => setSettlementDialogOpen(true)}
          onRunFullEod={handleRunFullEod}
          onGenerateReport={() => toast.info("Generate Report - Coming soon")}
          onClearSelected={handleClearSelected}
          onStop={handleStop}
          onAutoCreateMissing={handleAutoCreateMissing}
          isRunning={running}
          isStopping={stopping}
          isClearing={clearing}
          isProcessingStaged={processingStaged}
          isAutoCreating={autoCreating}
          hasDateSelected={hasDateSelected}
        />

        {/* Unmatched Data Warning - show when there are missing investors */}
        {hasUnmatchedData && !running && hasDateSelected && (
          <Alert variant="warning">
            <UserPlus className="h-4 w-4" />
            <AlertTitle>Missing Investor Records Detected</AlertTitle>
            <AlertDescription className="mt-1">
              <p>
                Found <strong>{unmatchedData?.unmatched_trade_count}</strong> trades and{" "}
                <strong>{(unmatchedData?.unmatched_deposit_count ?? 0) + (unmatchedData?.unmatched_withdrawal_count ?? 0)}</strong> cash transactions 
                with investor codes not in the master table.
              </p>
              {unmatchedData?.sample_codes && unmatchedData.sample_codes.length > 0 && (
                <p className="mt-1 text-xs">
                  Sample codes: {unmatchedData.sample_codes.slice(0, 8).join(", ")}
                  {unmatchedData.sample_codes.length > 8 && "..."}
                </p>
              )}
              <p className="mt-2 text-xs">
                Click "Auto-Create Missing" to generate placeholder records before processing.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* DSE Trade Import Dialog */}
        <DseTradeImportDialog
          open={dseImportDialogOpen}
          onOpenChange={setDseImportDialogOpen}
          selectedDate={selectedDate}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ["eod-run-history"] })}
        />

        {/* CSE Trade Import Dialog */}
        <CseTradeImportDialog
          open={cseImportDialogOpen}
          onOpenChange={setCseImportDialogOpen}
          selectedDate={selectedDate}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ["eod-run-history"] })}
        />

        {/* Deposits/Withdrawals Import Dialog */}
        <DepositsImportDialog
          open={depositsDialogOpen}
          onOpenChange={setDepositsDialogOpen}
          onImportComplete={() => {
            queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
            toast.success("Deposits/Withdrawals ready for EOD");
          }}
        />

        {/* Settlement Calculation Dialog */}
        <SettlementCalculationDialog
          open={settlementDialogOpen}
          onOpenChange={setSettlementDialogOpen}
          settlementDate={selectedDate}
        />

        {/* Progress Bar */}
        <EodProgressBar
          progress={progress}
          currentDate={currentDateProcessing}
          processedDays={processedDays}
          totalDays={totalDays}
          visible={running}
        />

        {/* Error Alert - show prominently when EOD fails */}
        {lastError && (failedCount > 0 || (stagedResult && !stagedResult.success)) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>EOD Processing Failed</AlertTitle>
            <AlertDescription className="mt-2">
              {lastError}
            </AlertDescription>
          </Alert>
        )}

        {/* Stale Data Warning - show when staging data differs from historical */}
        {isDataStale && !running && (!stagedResult || !stagedResult.success) && dayResults.length === 0 && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Data Changed Since Last EOD</AlertTitle>
            <AlertDescription className="mt-1">
              Deposits/Withdrawals have been updated since the last EOD run. 
              Click "Process Staged" or "Run Full EOD" to recalculate with the new data.
            </AlertDescription>
          </Alert>
        )}

        {/* Historical Data Alert - show when viewing saved EOD data (even after failed processing) */}
        {historicalData && !running && (!stagedResult || !stagedResult.success) && dayResults.length === 0 && !isDataStale && (
          <Alert variant="success">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>EOD Data Available</AlertTitle>
            <AlertDescription className="mt-1">
              Showing saved EOD data from {format(new Date(historicalData.run_at), "PPp")}
              {historicalData.run_by_email && ` by ${historicalData.run_by_email}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Cards - Priority: successful staged result > successful batch result > historical data */}
        {(() => {
          // Only use stagedResult if it was successful
          const useStaged = stagedResult?.success === true;
          // Only use batch results if at least one was successful (don't hide historical data for failed runs)
          const useBatch = dayResults.length > 0 && dayResults.some(r => r.success);
          
          return (
            <EodSummaryCards
              totalTrades={
                useStaged ? (stagedResult?.trade_count ?? 0) :
                useBatch ? summary.totalTrades :
                historicalData?.trade_files_count ?? 0
              }
              clientsCaptured={
                useStaged ? (stagedResult?.snapshots_created ?? 0) :
                useBatch ? summary.clientsCaptured :
                historicalData?.clients_captured ?? 0
              }
              grossBuy={
                useStaged ? (stagedResult?.gross_buy ?? 0) :
                useBatch ? summary.grossBuy :
                historicalData?.gross_buy ?? 0
              }
              grossSell={
                useStaged ? (stagedResult?.gross_sell ?? 0) :
                useBatch ? summary.grossSell :
                historicalData?.gross_sell ?? 0
              }
              totalCommission={
                useStaged ? (stagedResult?.total_commission ?? 0) :
                useBatch ? summary.totalCommission :
                historicalData?.total_commission ?? 0
              }
              totalDeposits={
                useStaged ? (stagedResult?.total_deposits ?? 0) :
                useBatch ? summary.totalDeposits :
                stagingSummary?.totalDeposits ?? historicalData?.total_deposits ?? 0
              }
              totalWithdrawals={
                useStaged ? (stagedResult?.total_withdrawals ?? 0) :
                useBatch ? summary.totalWithdrawals :
                stagingSummary?.totalWithdrawals ?? historicalData?.total_withdrawals ?? 0
              }
              errorsCount={
                useStaged ? 0 :
                useBatch ? summary.errorsCount :
                0
              }
              positionsCaptured={useStaged ? (stagedResult?.positions_captured ?? 0) : 0}
              totalMarketValue={useStaged ? (stagedResult?.total_market_value ?? 0) : 0}
              marginAccounts={useStaged ? (stagedResult?.margin_accounts ?? 0) : 0}
              marginExposure={useStaged ? (stagedResult?.margin_exposure ?? 0) : 0}
              dailyInterestTotal={useStaged ? (stagedResult?.daily_interest_total ?? 0) : 0}
              totalEquity={useStaged ? (stagedResult?.total_equity ?? 0) : 0}
              negativeEquityCount={useStaged ? (stagedResult?.negative_equity_count ?? 0) : 0}
              visible={showSummary || !!historicalData}
            />
          );
        })()}

        {/* EOD Log Table */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">EOD Run History</h3>
          <EodLogTable limit={20} />
        </div>
      </div>
    </MainLayout>
  );
}
