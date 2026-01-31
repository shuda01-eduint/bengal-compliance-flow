import { Button } from "@/components/ui/button";
import {
  Upload,
  Play,
  Calculator,
  FileText,
  Loader2,
  Square,
  Trash2,
  Wallet,
} from "lucide-react";

interface EodActionButtonsProps {
  onImportTrades: () => void;
  onImportDeposits: () => void;
  onProcessStaged: () => void;
  onCalculateSettlements: () => void;
  onRunFullEod: () => void;
  onGenerateReport: () => void;
  onClearSelected?: () => void;
  onStop?: () => void;
  isRunning: boolean;
  isStopping?: boolean;
  isClearing?: boolean;
  disabled?: boolean;
  hasDateSelected?: boolean;
}

export function EodActionButtons({
  onImportTrades,
  onImportDeposits,
  onProcessStaged,
  onCalculateSettlements,
  onRunFullEod,
  onGenerateReport,
  onClearSelected,
  onStop,
  isRunning,
  isStopping,
  isClearing,
  disabled,
  hasDateSelected,
}: EodActionButtonsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        onClick={onImportTrades}
        disabled={disabled || isRunning}
      >
        <Upload className="mr-2 h-4 w-4" />
        Import Trades
      </Button>

      <Button
        variant="outline"
        onClick={onImportDeposits}
        disabled={disabled || isRunning}
      >
        <Wallet className="mr-2 h-4 w-4" />
        Import Deposits/Withdrawals
      </Button>

      <Button
        variant="outline"
        onClick={onProcessStaged}
        disabled={disabled || isRunning || !hasDateSelected}
      >
        <Calculator className="mr-2 h-4 w-4" />
        Process Staged Trades
      </Button>

      <Button
        variant="outline"
        onClick={onCalculateSettlements}
        disabled={disabled || isRunning || !hasDateSelected}
      >
        <Calculator className="mr-2 h-4 w-4" />
        Calculate Settlements
      </Button>

      {isRunning ? (
        <Button
          variant="destructive"
          onClick={onStop}
          disabled={isStopping}
        >
          {isStopping ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Square className="mr-2 h-4 w-4" />
          )}
          {isStopping ? "Stopping..." : "Stop"}
        </Button>
      ) : (
        <Button
          onClick={onRunFullEod}
          disabled={disabled || !hasDateSelected}
          className="bg-primary hover:bg-primary/90"
        >
          <Play className="mr-2 h-4 w-4" />
          Run Full EOD
        </Button>
      )}

      <Button
        variant="outline"
        onClick={onGenerateReport}
        disabled={disabled || isRunning || !hasDateSelected}
      >
        <FileText className="mr-2 h-4 w-4" />
        Generate Report
      </Button>

      {onClearSelected && (
        <Button
          variant="outline"
          onClick={onClearSelected}
          disabled={disabled || isRunning || isClearing || !hasDateSelected}
          className="text-destructive hover:bg-destructive/10"
        >
          {isClearing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Clear Selected
        </Button>
      )}
    </div>
  );
}
