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
import { ArrowDown, ArrowUp, Calendar, FileSpreadsheet, AlertTriangle } from "lucide-react";
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
}

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewData: ImportPreviewData | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ImportPreviewDialog = ({
  open,
  onOpenChange,
  previewData,
  onConfirm,
  onCancel,
}: ImportPreviewDialogProps) => {
  if (!previewData) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const netAmount = previewData.totalDeposits - previewData.totalWithdrawals;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Preview
          </AlertDialogTitle>
          <AlertDialogDescription>
            Review the import details before proceeding.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
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
              {previewData.duplicateRows > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Duplicates (will skip)</span>
                  <span className="font-medium text-orange-500">{previewData.duplicateRows.toLocaleString()}</span>
                </div>
              )}
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span className="text-primary">Will Import</span>
                  <Badge>{previewData.newRows.toLocaleString()} records</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowDown className="h-4 w-4 text-green-500" />
                  <span>
                    Deposits <span className="text-muted-foreground">({previewData.depositCount})</span>
                  </span>
                </div>
                <span className="font-mono font-medium text-green-600">
                  ৳{formatCurrency(previewData.totalDeposits)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowUp className="h-4 w-4 text-red-500" />
                  <span>
                    Withdrawals <span className="text-muted-foreground">({previewData.withdrawalCount})</span>
                  </span>
                </div>
                <span className="font-mono font-medium text-red-600">
                  ৳{formatCurrency(previewData.totalWithdrawals)}
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

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            disabled={previewData.newRows === 0}
          >
            {previewData.newRows === 0 ? 'Nothing to Import' : `Import ${previewData.newRows} Records`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
