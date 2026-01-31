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
    return `৳${value.toLocaleString()}`;
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>EOD Date</TableHead>
            <TableHead>Run At</TableHead>
            <TableHead>Run By</TableHead>
            <TableHead className="text-right">Clients</TableHead>
            <TableHead className="text-right">Ledger Balance</TableHead>
            <TableHead className="text-right">Trade Files</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                {format(new Date(row.run_date), "dd MMM yyyy")}
              </TableCell>
              <TableCell>
                {format(new Date(row.run_at), "dd MMM HH:mm")}
              </TableCell>
              <TableCell className="max-w-[150px] truncate">
                {row.run_by_email || "-"}
              </TableCell>
              <TableCell className="text-right">
                {row.clients_captured.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {formatCurrency(row.total_ledger_balance)}
              </TableCell>
              <TableCell className="text-right">
                {row.trade_files_count ?? "-"}
              </TableCell>
              <TableCell>{getStatusBadge(row.status)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
