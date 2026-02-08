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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowDown, ArrowUp, Calendar, FileSpreadsheet, AlertTriangle, Trash2 } from "lucide-react";
import { format } from "date-fns";

export interface ImportPreviewData {
  fileDate: string | null;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  newRows: number;
  totalDeposits: number;
  totalWithdrawals: number;
  depositCount: number;
  withdrawalCount: number;
  existingRecordsCount?: number;
  // Totals for ALL valid records (used when "Replace" is selected)
  allTotalDeposits?: number;
  allTotalWithdrawals?: number;
  allDepositCount?: number;
  allWithdrawalCount?: number;
}

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewData: ImportPreviewData | null;
  onConfirm: () => void;
  onCancel: () => void;
  showReplaceOption?: boolean;
  replaceExisting?: boolean;
  onReplaceChange?: (replace: boolean) => void;
}

export const ImportPreviewDialog = ({
  open,
  onOpenChange,
  previewData,
  onConfirm,
  onCancel,
  showReplaceOption = false,
  replaceExisting = false,
  onReplaceChange,
}: ImportPreviewDialogProps) => {
  if (!previewData) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Use ALL records totals when replacing, otherwise use unique records totals
  const displayDeposits = replaceExisting && previewData.allTotalDeposits !== undefined
    ? previewData.allTotalDeposits 
    : previewData.totalDeposits;
  const displayWithdrawals = replaceExisting && previewData.allTotalWithdrawals !== undefined
    ? previewData.allTotalWithdrawals 
    : previewData.totalWithdrawals;
  const displayDepositCount = replaceExisting && previewData.allDepositCount !== undefined
    ? previewData.allDepositCount 
    : previewData.depositCount;
  const displayWithdrawalCount = replaceExisting && previewData.allWithdrawalCount !== undefined
    ? previewData.allWithdrawalCount 
    : previewData.withdrawalCount;

  const netAmount = displayDeposits - displayWithdrawals;
  const recordsToImport = replaceExisting ? previewData.validRows : previewData.newRows;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Preview
          </AlertDialogTitle>
          <AlertDialogDescription>
            Review the import details before proceeding.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto max-h-[60vh]">
          {/* Date Detection */}
          <Card className="border-primary/20">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Detected Date
                </div>
                <Badge variant="secondary" className="font-mono">
                  {previewData.fileDate 
                    ? format(new Date(previewData.fileDate + 'T00:00:00'), 'dd MMM yyyy')
                    : 'Not detected'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Row Counts */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Rows in File</span>
                <span className="font-medium">{previewData.totalRows.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Valid Records</span>
                <span className="font-medium text-green-600">{previewData.validRows.toLocaleString()}</span>
              </div>
              {previewData.errorRows > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                    Validation Errors
                  </span>
                  <span className="font-medium text-yellow-600">{previewData.errorRows.toLocaleString()}</span>
                </div>
              )}
              {previewData.duplicateRows > 0 && !replaceExisting && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Duplicates (will skip)</span>
                  <span className="font-medium text-orange-500">{previewData.duplicateRows.toLocaleString()}</span>
                </div>
              )}
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span className="text-primary">Will Import</span>
                  <Badge>{recordsToImport.toLocaleString()} records</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Replace Existing Option */}
          {showReplaceOption && previewData.existingRecordsCount !== undefined && previewData.existingRecordsCount > 0 && (
            <Card className={replaceExisting ? "border-destructive/50 bg-destructive/5" : ""}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start space-x-3">
                  <Checkbox 
                    id="replace-existing" 
                    checked={replaceExisting}
                    onCheckedChange={(checked) => onReplaceChange?.(checked === true)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label 
                      htmlFor="replace-existing" 
                      className="text-sm font-medium cursor-pointer"
                    >
                      Replace existing data for this date
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {previewData.existingRecordsCount.toLocaleString()} existing records found
                    </p>
                  </div>
                </div>
                
                {replaceExisting && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
                    <Trash2 className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-xs text-destructive font-medium">
                      This will delete {previewData.existingRecordsCount.toLocaleString()} existing records and import {previewData.validRows.toLocaleString()} new records
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Totals */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowDown className="h-4 w-4 text-green-500" />
                  <span>
                    Deposits <span className="text-muted-foreground">({displayDepositCount})</span>
                  </span>
                </div>
                <span className="font-mono font-medium text-green-600">
                  ৳{formatCurrency(displayDeposits)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowUp className="h-4 w-4 text-red-500" />
                  <span>
                    Withdrawals <span className="text-muted-foreground">({displayWithdrawalCount})</span>
                  </span>
                </div>
                <span className="font-mono font-medium text-red-600">
                  ৳{formatCurrency(displayWithdrawals)}
                </span>
              </div>
              <div className="border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Net Amount</span>
                  <span className={`font-mono font-bold ${netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {netAmount >= 0 ? '+' : ''}৳{formatCurrency(netAmount)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <AlertDialogFooter className="flex-shrink-0 pt-4">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            disabled={recordsToImport === 0}
            className={replaceExisting ? "bg-destructive hover:bg-destructive/90" : ""}
          >
            {recordsToImport === 0 
              ? 'Nothing to Import' 
              : replaceExisting 
                ? `Replace & Import ${recordsToImport} Records`
                : `Import ${recordsToImport} Records`
            }
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};