import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface EodRunHistory {
  id: string;
  run_date: string;
  run_at: string;
  run_by_email: string | null;
  clients_captured: number;
  total_ledger_balance: number;
  trade_files_count: number | null;
  deposit_records_count: number | null;
  status: string;
  gross_buy: number | null;
  gross_sell: number | null;
  total_commission: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
}

interface EodLogTableProps {
  limit?: number;
}

export function EodLogTable({ limit = 20 }: EodLogTableProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["eod-run-history", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eod_run_history")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as EodRunHistory[];
    },
  });

  const formatCurrency = (value: number | null): string => {
    if (value === null || value === undefined) return "-";
    if (value >= 1e9) return `৳${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `৳${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `৳${(value / 1e3).toFixed(1)}K`;
    return `৳${value.toLocaleString()}`;
  };

  const formatNetFlow = (deposits: number | null, withdrawals: number | null): { value: string; isPositive: boolean } => {
    const dep = deposits ?? 0;
    const with_ = withdrawals ?? 0;
    const net = dep - with_;
    const isPositive = net >= 0;
    const prefix = isPositive ? "+" : "";
    return { value: `${prefix}${formatCurrency(net)}`, isPositive };
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "destructive" | "secondary" | "outline"; className: string }> = {
      completed: { variant: "default", className: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400" },
      failed: { variant: "destructive", className: "" },
      running: { variant: "secondary", className: "bg-primary/20 text-primary" },
      pending: { variant: "outline", className: "" },
    };
    const { className } = variants[status] || variants.pending;
    return (
      <Badge variant="outline" className={cn("capitalize", className)}>
        {status}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-8 text-center">
        <p className="text-muted-foreground">No EOD runs found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">EOD Date</TableHead>
            <TableHead className="whitespace-nowrap">Run At</TableHead>
            <TableHead className="whitespace-nowrap">Run By</TableHead>
            <TableHead className="text-right whitespace-nowrap">Clients</TableHead>
            <TableHead className="text-right whitespace-nowrap">Deposits</TableHead>
            <TableHead className="text-right whitespace-nowrap">Withdrawals</TableHead>
            <TableHead className="text-right whitespace-nowrap">Net Flow</TableHead>
            <TableHead className="text-right whitespace-nowrap">Gross Buy</TableHead>
            <TableHead className="text-right whitespace-nowrap">Gross Sell</TableHead>
            <TableHead className="text-right whitespace-nowrap">Total Trades</TableHead>
            <TableHead className="text-right whitespace-nowrap">Commission</TableHead>
            <TableHead className="whitespace-nowrap">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((row) => {
            const netFlow = formatNetFlow(row.total_deposits, row.total_withdrawals);
            const totalTrades = (row.gross_buy ?? 0) + (row.gross_sell ?? 0);
            
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {format(new Date(row.run_date), "dd MMM yyyy")}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {format(new Date(row.run_at), "dd MMM HH:mm")}
                </TableCell>
                <TableCell className="max-w-[120px] truncate">
                  {row.run_by_email || "-"}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {row.clients_captured.toLocaleString()}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatCurrency(row.total_deposits)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatCurrency(row.total_withdrawals)}
                </TableCell>
                <TableCell className={cn(
                  "text-right whitespace-nowrap font-medium",
                  netFlow.isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}>
                  {netFlow.value}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatCurrency(row.gross_buy)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatCurrency(row.gross_sell)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap font-medium">
                  {formatCurrency(totalTrades)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatCurrency(row.total_commission)}
                </TableCell>
                <TableCell>{getStatusBadge(row.status)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
