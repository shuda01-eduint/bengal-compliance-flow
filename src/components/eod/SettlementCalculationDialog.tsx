import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Download, Search, TrendingUp, TrendingDown, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface SettlementCalculationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settlementDate: Date | undefined;
}

interface SettlementRow {
  investor_code: string;
  buy_settlement: number;
  sell_settlement: number;
  net_settlement: number;
}

export function SettlementCalculationDialog({
  open,
  onOpenChange,
  settlementDate,
}: SettlementCalculationDialogProps) {
  const [search, setSearch] = useState("");
  
  const dateStr = settlementDate ? format(settlementDate, "yyyy-MM-dd") : null;

  const { data: settlements, isLoading } = useQuery({
    queryKey: ["settlement-calculation", dateStr],
    queryFn: async () => {
      if (!dateStr) return [];
      
      // Query trades settling on this date
      const { data, error } = await supabase
        .from("trade_file")
        .select("investor_code, side, qty, price")
        .eq("settlement_date", dateStr);

      if (error) throw error;

      // Aggregate by investor
      const aggregated = new Map<string, { buy: number; sell: number }>();
      
      for (const trade of data || []) {
        const key = trade.investor_code;
        if (!aggregated.has(key)) {
          aggregated.set(key, { buy: 0, sell: 0 });
        }
        const agg = aggregated.get(key)!;
        const value = (trade.qty ?? 0) * (trade.price ?? 0);
        const sideUpper = (trade.side || "").toUpperCase();
        
        if (sideUpper === "B" || sideUpper === "BUY") {
          agg.buy += value;
        } else if (sideUpper === "S" || sideUpper === "SELL") {
          agg.sell += value;
        }
      }

      // Convert to array and sort by absolute net
      const result: SettlementRow[] = [];
      for (const [investor_code, { buy, sell }] of aggregated.entries()) {
        result.push({
          investor_code,
          buy_settlement: buy,
          sell_settlement: sell,
          net_settlement: sell - buy, // Positive = receives, Negative = pays
        });
      }

      result.sort((a, b) => Math.abs(b.net_settlement) - Math.abs(a.net_settlement));
      return result;
    },
    enabled: open && !!dateStr,
  });

  // Summary calculations
  const summary = useMemo(() => {
    if (!settlements || settlements.length === 0) {
      return { totalBuy: 0, totalSell: 0, netPosition: 0, investorCount: 0 };
    }
    return {
      totalBuy: settlements.reduce((sum, s) => sum + s.buy_settlement, 0),
      totalSell: settlements.reduce((sum, s) => sum + s.sell_settlement, 0),
      netPosition: settlements.reduce((sum, s) => sum + s.net_settlement, 0),
      investorCount: settlements.length,
    };
  }, [settlements]);

  // Filtered settlements
  const filteredSettlements = useMemo(() => {
    if (!settlements) return [];
    if (!search.trim()) return settlements;
    const term = search.toLowerCase();
    return settlements.filter((s) =>
      s.investor_code.toLowerCase().includes(term)
    );
  }, [settlements, search]);

  const formatCurrency = (value: number): string => {
    if (value >= 1e9) return `৳${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `৳${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `৳${(value / 1e3).toFixed(1)}K`;
    return `৳${value.toLocaleString()}`;
  };

  const formatSignedCurrency = (value: number): { text: string; isPositive: boolean } => {
    const isPositive = value >= 0;
    const prefix = isPositive ? "+" : "";
    return { text: `${prefix}${formatCurrency(value)}`, isPositive };
  };

  const handleExport = () => {
    if (!settlements || settlements.length === 0) return;

    const exportData = settlements.map((s) => ({
      "Investor Code": s.investor_code,
      "Buy Settlement": s.buy_settlement,
      "Sell Settlement": s.sell_settlement,
      "Net Settlement": s.net_settlement,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Settlements");
    XLSX.writeFile(wb, `settlements_${dateStr}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Settlement Calculations
            {settlementDate && (
              <Badge variant="outline" className="ml-2">
                {format(settlementDate, "dd MMM yyyy")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <TrendingDown className="h-4 w-4 text-red-500" />
                Buy Obligations
              </div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400">
                {isLoading ? <Skeleton className="h-7 w-24" /> : formatCurrency(summary.totalBuy)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Sell Receipts
              </div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {isLoading ? <Skeleton className="h-7 w-24" /> : formatCurrency(summary.totalSell)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <ArrowRightLeft className="h-4 w-4" />
                Net Position
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <div className={cn(
                  "text-xl font-bold",
                  summary.netPosition >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}>
                  {formatSignedCurrency(summary.netPosition).text}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Search and Export */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search investor code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!settlements || settlements.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>

        {/* Investor Count */}
        {!isLoading && settlements && (
          <div className="text-sm text-muted-foreground">
            Showing {filteredSettlements.length} of {summary.investorCount} investors
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto min-h-0 rounded-md border">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredSettlements.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {settlements?.length === 0
                ? "No trades settling on this date"
                : "No matching investors found"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Investor Code</TableHead>
                  <TableHead className="text-right">Buy Settlement</TableHead>
                  <TableHead className="text-right">Sell Settlement</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSettlements.slice(0, 100).map((row) => {
                  const net = formatSignedCurrency(row.net_settlement);
                  return (
                    <TableRow key={row.investor_code}>
                      <TableCell className="font-medium">
                        {row.investor_code}
                      </TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400">
                        {formatCurrency(row.buy_settlement)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {formatCurrency(row.sell_settlement)}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        net.isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      )}>
                        {net.text}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {filteredSettlements.length > 100 && (
          <div className="text-sm text-muted-foreground text-center">
            Showing first 100 of {filteredSettlements.length} investors. Export for full list.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
