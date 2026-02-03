import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertCircle, CheckCircle2, AlertTriangle, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { EodDateSelector } from "@/components/eod/EodDateSelector";
import { EodActionButtons } from "@/components/eod/EodActionButtons";
import { EodSummaryCards } from "@/components/eod/EodSummaryCards";
import { EodLogTable } from "@/components/eod/EodLogTable";
import { DseTradeImportDialog } from "@/components/eod/DseTradeImportDialog";
import { CseTradeImportDialog } from "@/components/eod/CseTradeImportDialog";
import { DepositsImportDialog } from "@/components/eod/DepositsImportDialog";
import { MarginListImportDialog } from "@/components/eod/MarginListImportDialog";
import { SettlementCalculationDialog } from "@/components/eod/SettlementCalculationDialog";
import { useEodHistoricalData } from "@/hooks/useEodHistoricalData";
import { useEodStagingSummary } from "@/hooks/useEodStagingSummary";
import { useUnmatchedStagingData, hasSignificantUnmatchedData } from "@/hooks/useUnmatchedStagingData";

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
  
  // Date selection (single day only)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // Fetch historical data for selected date
  const { data: historicalData } = useEodHistoricalData(selectedDate);
  
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
  const [marginListDialogOpen, setMarginListDialogOpen] = useState(false);
  const [settlementDialogOpen, setSettlementDialogOpen] = useState(false);

  // Processing state
  const [clearing, setClearing] = useState(false);
  const [processingStaged, setProcessingStaged] = useState(false);

  // Results
  const [showSummary, setShowSummary] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [stagedResult, setStagedResult] = useState<ProcessStagedResult | null>(null);

  const hasDateSelected = !!selectedDate;

  const handleClearSelected = async () => {
    if (!selectedDate) return;
    
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const dateLabel = format(selectedDate, "MMM d, yyyy");

    if (!confirm(`Clear EOD data for ${dateLabel}? This cannot be undone.`)) {
      return;
    }

    setClearing(true);
    try {
      const { data, error } = await supabase.rpc("clear_eod_by_date_range", {
        p_from_date: dateStr,
        p_to_date: dateStr,
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

  const handleImportMarginList = () => {
    setMarginListDialogOpen(true);
  };

  const handleProcessStaged = async () => {
    if (!selectedDate) {
      toast.error("Please select a date first");
      return;
    }

    setProcessingStaged(true);
    setStagedResult(null);
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

  // Determine if we should show staged result or historical data
  const useStaged = stagedResult?.success === true;

  return (
    <MainLayout title="EOD Processing" subtitle="Process end-of-day calculations and settlements">
      <div className="space-y-6">

        {/* Date Selector */}
        <EodDateSelector
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          disabled={processingStaged}
        />

        {/* Action Buttons */}
        <EodActionButtons
          onImportDseTrades={handleImportDseTrades}
          onImportCseTrades={handleImportCseTrades}
          onImportDeposits={handleImportDeposits}
          onImportMarginList={handleImportMarginList}
          onProcessStaged={handleProcessStaged}
          onCalculateSettlements={() => setSettlementDialogOpen(true)}
          onGenerateReport={() => toast.info("Generate Report - Coming soon")}
          onClearSelected={handleClearSelected}
          onAutoCreateMissing={handleAutoCreateMissing}
          isClearing={clearing}
          isProcessingStaged={processingStaged}
          isAutoCreating={autoCreating}
          hasDateSelected={hasDateSelected}
        />

        {/* Unmatched Data Warning - show when there are missing investors */}
        {hasUnmatchedData && hasDateSelected && (
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

        {/* Margin List & Prices Import Dialog */}
        <MarginListImportDialog
          open={marginListDialogOpen}
          onOpenChange={setMarginListDialogOpen}
          selectedDate={selectedDate ?? null}
          onImportComplete={() => {
            queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
          }}
        />

        {/* Settlement Calculation Dialog */}
        <SettlementCalculationDialog
          open={settlementDialogOpen}
          onOpenChange={setSettlementDialogOpen}
          settlementDate={selectedDate}
        />

        {/* Error Alert - show prominently when EOD fails */}
        {lastError && stagedResult && !stagedResult.success && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>EOD Processing Failed</AlertTitle>
            <AlertDescription className="mt-2">
              {lastError}
            </AlertDescription>
          </Alert>
        )}

        {/* Stale Data Warning - show when staging data differs from historical */}
        {isDataStale && (!stagedResult || !stagedResult.success) && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Data Changed Since Last EOD</AlertTitle>
            <AlertDescription className="mt-1">
              Deposits/Withdrawals have been updated since the last EOD run. 
              Click "Process Staged Trades" to recalculate with the new data.
            </AlertDescription>
          </Alert>
        )}

        {/* Historical Data Alert - show when viewing saved EOD data */}
        {historicalData && (!stagedResult || !stagedResult.success) && !isDataStale && (
          <Alert variant="success">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>EOD Data Available</AlertTitle>
            <AlertDescription className="mt-1">
              Showing saved EOD data from {format(new Date(historicalData.run_at), "PPp")}
              {historicalData.run_by_email && ` by ${historicalData.run_by_email}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Cards - Priority: successful staged result > historical data */}
        <EodSummaryCards
          totalTrades={
            useStaged ? (stagedResult?.trade_count ?? 0) :
            historicalData?.trade_files_count ?? 0
          }
          clientsCaptured={
            useStaged ? (stagedResult?.snapshots_created ?? 0) :
            historicalData?.clients_captured ?? 0
          }
          grossBuy={
            useStaged ? (stagedResult?.gross_buy ?? 0) :
            historicalData?.gross_buy ?? 0
          }
          grossSell={
            useStaged ? (stagedResult?.gross_sell ?? 0) :
            historicalData?.gross_sell ?? 0
          }
          totalCommission={
            useStaged ? (stagedResult?.total_commission ?? 0) :
            historicalData?.total_commission ?? 0
          }
          totalDeposits={
            useStaged ? (stagedResult?.total_deposits ?? 0) :
            stagingSummary?.totalDeposits ?? historicalData?.total_deposits ?? 0
          }
          totalWithdrawals={
            useStaged ? (stagedResult?.total_withdrawals ?? 0) :
            stagingSummary?.totalWithdrawals ?? historicalData?.total_withdrawals ?? 0
          }
          errorsCount={0}
          positionsCaptured={useStaged ? (stagedResult?.positions_captured ?? 0) : 0}
          totalMarketValue={useStaged ? (stagedResult?.total_market_value ?? 0) : 0}
          marginAccounts={useStaged ? (stagedResult?.margin_accounts ?? 0) : 0}
          marginExposure={useStaged ? (stagedResult?.margin_exposure ?? 0) : 0}
          dailyInterestTotal={useStaged ? (stagedResult?.daily_interest_total ?? 0) : 0}
          totalEquity={useStaged ? (stagedResult?.total_equity ?? 0) : 0}
          negativeEquityCount={useStaged ? (stagedResult?.negative_equity_count ?? 0) : 0}
          visible={showSummary || !!historicalData}
        />

        {/* EOD Log Table */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">EOD Run History</h3>
          <EodLogTable limit={20} />
        </div>
      </div>
    </MainLayout>
  );
}
