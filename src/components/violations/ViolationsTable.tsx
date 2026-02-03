import { useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InvestorViolationDialog } from "./InvestorViolationDialog";

export interface ViolationRecord {
  event_date: string;
  client_code: string;
  client_name: string;
  violation_type: "negative_balance" | "over_buy" | "z_group_adjustment" | "non_margin_buy";
  amount: number;
  rm_name: string;
  details?: string;
  // Over Buy specific fields
  opening_balance?: number;
  closing_balance?: number;
  loan_increase?: number;
  // Negative Balance specific fields
  previous_balance?: number;
  days_negative?: number;
}

interface ViolationsTableProps {
  records: ViolationRecord[];
  isLoading: boolean;
  activeFilter?: string;
}

const violationLabels = {
  negative_balance: { label: "Negative Balance", variant: "destructive" as const },
  over_buy: { label: "Over Buy", variant: "default" as const },
  z_group_adjustment: { label: "Z Group Adjustment", variant: "secondary" as const },
  non_margin_buy: { label: "Non-Margin Buy", variant: "outline" as const },
};

const violationColors = {
  negative_balance: "bg-red-500/20 text-red-400 border-red-500/30",
  over_buy: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  z_group_adjustment: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  non_margin_buy: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export function ViolationsTable({ records, isLoading, activeFilter }: ViolationsTableProps) {
  const [selectedClientCode, setSelectedClientCode] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const isOverBuyView = activeFilter === "over_buy";
  const isNegativeBalanceView = activeFilter === "negative_balance";

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatEventDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return format(date, "dd MMM yyyy");
    } catch {
      return dateStr;
    }
  };

  const handleClientClick = (clientCode: string) => {
    setSelectedClientCode(clientCode);
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading violations...</p>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">No violations found for the selected criteria</p>
      </div>
    );
  }

  // Render Negative Balance specific table
  if (isNegativeBalanceView) {
    return (
      <>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client Code</TableHead>
                <TableHead>Client Name</TableHead>
                <TableHead className="text-right">Previous Balance</TableHead>
                <TableHead className="text-right">Current Balance</TableHead>
                <TableHead className="text-right">Days Negative</TableHead>
                <TableHead>RM Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record, index) => (
                <TableRow key={`${record.client_code}-${index}`}>
                  <TableCell>
                    <button
                      onClick={() => handleClientClick(record.client_code)}
                      className="font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
                    >
                      {record.client_code}
                    </button>
                  </TableCell>
                  <TableCell>{record.client_name}</TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    {formatCurrency(record.previous_balance ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-destructive">
                    {formatCurrency(record.closing_balance ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {record.days_negative ?? 0}
                  </TableCell>
                  <TableCell>{record.rm_name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <InvestorViolationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          clientCode={selectedClientCode}
        />
      </>
    );
  }

  // Render Over Buy specific table
  if (isOverBuyView) {
    return (
      <>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client Code</TableHead>
                <TableHead>Client Name</TableHead>
                <TableHead className="text-right">Opening Balance</TableHead>
                <TableHead className="text-right">Closing Balance</TableHead>
                <TableHead className="text-right">Loan Increase</TableHead>
                <TableHead>RM Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record, index) => (
                <TableRow key={`${record.client_code}-${index}`}>
                  <TableCell>
                    <button
                      onClick={() => handleClientClick(record.client_code)}
                      className="font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
                    >
                      {record.client_code}
                    </button>
                  </TableCell>
                  <TableCell>{record.client_name}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(record.opening_balance ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-destructive">
                    {formatCurrency(record.closing_balance ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-orange-500">
                    {formatCurrency(record.loan_increase ?? 0)}
                  </TableCell>
                  <TableCell>{record.rm_name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <InvestorViolationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          clientCode={selectedClientCode}
        />
      </>
    );
  }

  // Default table view
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event Date</TableHead>
              <TableHead>Client Code</TableHead>
              <TableHead>Client Name</TableHead>
              <TableHead>Violation Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>RM Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record, index) => (
              <TableRow key={`${record.client_code}-${record.event_date}-${index}`}>
                <TableCell>{formatEventDate(record.event_date)}</TableCell>
                <TableCell>
                  <button
                    onClick={() => handleClientClick(record.client_code)}
                    className="font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
                  >
                    {record.client_code}
                  </button>
                </TableCell>
                <TableCell>{record.client_name}</TableCell>
                <TableCell>
                  <Badge 
                    variant="outline"
                    className={cn("border", violationColors[record.violation_type])}
                  >
                    {violationLabels[record.violation_type].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium text-destructive">
                  {formatCurrency(record.amount)}
                </TableCell>
                <TableCell>{record.rm_name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <InvestorViolationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientCode={selectedClientCode}
      />
    </>
  );
}
