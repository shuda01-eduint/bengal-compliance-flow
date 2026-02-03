import { Button } from "@/components/ui/button";
import {
  Upload,
  Calculator,
  FileText,
  Loader2,
  Trash2,
  Wallet,
  UserPlus,
  ListChecks,
} from "lucide-react";

interface EodActionButtonsProps {
  onImportDseTrades: () => void;
  onImportCseTrades: () => void;
  onImportDeposits: () => void;
  onImportMarginList: () => void;
  onProcessStaged: () => void;
  onCalculateSettlements: () => void;
  onGenerateReport: () => void;
  onClearSelected?: () => void;
  onAutoCreateMissing?: () => void;
  isClearing?: boolean;
  isProcessingStaged?: boolean;
  isAutoCreating?: boolean;
  disabled?: boolean;
  hasDateSelected?: boolean;
}

export function EodActionButtons({
  onImportDseTrades,
  onImportCseTrades,
  onImportDeposits,
  onImportMarginList,
  onProcessStaged,
  onCalculateSettlements,
  onGenerateReport,
  onClearSelected,
  onAutoCreateMissing,
  isClearing,
  isProcessingStaged,
  isAutoCreating,
  disabled,
  hasDateSelected,
}: EodActionButtonsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        onClick={onImportDseTrades}
        disabled={disabled}
      >
        <Upload className="mr-2 h-4 w-4" />
        Import DSE Trades
      </Button>

      <Button
        variant="outline"
        onClick={onImportCseTrades}
        disabled={disabled}
      >
        <Upload className="mr-2 h-4 w-4" />
        Import CSE Trades
      </Button>

      <Button
        variant="outline"
        onClick={onImportDeposits}
        disabled={disabled}
      >
        <Wallet className="mr-2 h-4 w-4" />
        Import Deposits / Withdrawals
      </Button>

      <Button
        variant="outline"
        onClick={onImportMarginList}
        disabled={disabled || !hasDateSelected}
      >
        <ListChecks className="mr-2 h-4 w-4" />
        Import Margin List & Prices
      </Button>

      <Button
        variant="default"
        onClick={onProcessStaged}
        disabled={disabled || isProcessingStaged || !hasDateSelected}
        className="bg-primary hover:bg-primary/90"
      >
        {isProcessingStaged ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Calculator className="mr-2 h-4 w-4" />
        )}
        {isProcessingStaged ? "Processing..." : "Process Staged Trades"}
      </Button>

      {onAutoCreateMissing && (
        <Button
          variant="outline"
          onClick={onAutoCreateMissing}
          disabled={disabled || isAutoCreating || !hasDateSelected}
          className="text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          {isAutoCreating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          {isAutoCreating ? "Creating..." : "Auto-Create Missing"}
        </Button>
      )}

      <Button
        variant="outline"
        onClick={onCalculateSettlements}
        disabled={disabled || !hasDateSelected}
      >
        <Calculator className="mr-2 h-4 w-4" />
        Calculate Settlements
      </Button>

      <Button
        variant="outline"
        onClick={onGenerateReport}
        disabled={disabled || !hasDateSelected}
      >
        <FileText className="mr-2 h-4 w-4" />
        Generate Report
      </Button>

      {onClearSelected && (
        <Button
          variant="outline"
          onClick={onClearSelected}
          disabled={disabled || isClearing || !hasDateSelected}
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
