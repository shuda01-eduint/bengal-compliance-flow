import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Download, X } from "lucide-react";
import * as XLSX from "xlsx";

interface HoldingWithClient {
  id: string;
  trading_code: string;
  investor_code: string;
  investor_name: string | null;
  total_stock: number | null;
  market_value: number | null;
  avg_cost: number | null;
  total_cost: number | null;
  ledger_balance: number | null;
  rm_email: string | null;
  close_price?: number | null;
  live_value?: number;
}

export function PortfolioReports() {
  const [search, setSearch] = useState("");
  const [rmFilter, setRmFilter] = useState<string>("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch holdings data
  const { data: holdings = [], isLoading: holdingsLoading } = useQuery({
    queryKey: ["portfolio-holdings", debouncedSearch, rmFilter],
    queryFn: async () => {
      let query = supabase
        .from("holdings")
        .select("*")
        .order("investor_code");

      if (debouncedSearch) {
        query = query.or(`investor_code.ilike.%${debouncedSearch}%,trading_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%`);
      }

      if (rmFilter && rmFilter !== "all") {
        query = query.eq("rm_email", rmFilter);
      }

      const { data, error } = await query.limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch securities for close prices
  const { data: securities = [] } = useQuery({
    queryKey: ["securities-prices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("securities")
        .select("trading_code, close_price");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch unique RM emails for filter
  const { data: rmEmails = [] } = useQuery({
    queryKey: ["rm-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holdings")
        .select("rm_email")
        .not("rm_email", "is", null);
      if (error) throw error;
      const unique = [...new Set(data?.map((h) => h.rm_email).filter(Boolean))];
      return unique as string[];
    },
  });

  // Create price lookup map
  const priceMap = new Map(securities.map((s) => [s.trading_code, s.close_price]));

  // Combine holdings with live values
  const enrichedHoldings: HoldingWithClient[] = holdings.map((h) => {
    const closePrice = priceMap.get(h.trading_code) || 0;
    const liveValue = (h.total_stock || 0) * closePrice;
    return {
      ...h,
      close_price: closePrice,
      live_value: liveValue,
    };
  });

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatInteger = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return new Intl.NumberFormat("en-US").format(value);
  };

  const handleExport = () => {
    const exportData = enrichedHoldings.map((h) => ({
      "Investor Code": h.investor_code,
      "Investor Name": h.investor_name || "",
      "Trading Code": h.trading_code,
      "Total Stock": h.total_stock || 0,
      "Close Price (MP)": h.close_price || 0,
      "Live Value (MP×Qty)": h.live_value || 0,
      "Ledger Balance": h.ledger_balance || 0,
      "Market Value": h.market_value || 0,
      "Total Cost": h.total_cost || 0,
      "Avg Cost": h.avg_cost || 0,
      "RM Email": h.rm_email || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Portfolio Report");
    XLSX.writeFile(wb, `portfolio_report_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Calculate totals
  const totals = enrichedHoldings.reduce(
    (acc, h) => ({
      totalStock: acc.totalStock + (h.total_stock || 0),
      liveValue: acc.liveValue + (h.live_value || 0),
      ledgerBalance: acc.ledgerBalance + (h.ledger_balance || 0),
      marketValue: acc.marketValue + (h.market_value || 0),
    }),
    { totalStock: 0, liveValue: 0, ledgerBalance: 0, marketValue: 0 }
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Portfolio Reports</CardTitle>
        <Button onClick={handleExport} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by investor code, name, or trading code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={rmFilter} onValueChange={setRmFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by RM" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All RMs</SelectItem>
              {rmEmails.map((email) => (
                <SelectItem key={email} value={email}>
                  {email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(search || rmFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setRmFilter("all");
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">Total Stock</p>
            <p className="text-lg font-semibold">{formatInteger(totals.totalStock)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Live Value (MP×Qty)</p>
            <p className="text-lg font-semibold">{formatNumber(totals.liveValue)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Ledger Balance</p>
            <p className="text-lg font-semibold">{formatNumber(totals.ledgerBalance)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Market Value</p>
            <p className="text-lg font-semibold">{formatNumber(totals.marketValue)}</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-md border overflow-auto max-h-[500px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Investor Code</TableHead>
                <TableHead>Investor Name</TableHead>
                <TableHead>Trading Code</TableHead>
                <TableHead className="text-right">Total Stock</TableHead>
                <TableHead className="text-right">Close Price (MP)</TableHead>
                <TableHead className="text-right">Live Value (MP×Qty)</TableHead>
                <TableHead className="text-right">Ledger Balance</TableHead>
                <TableHead className="text-right">Market Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdingsLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : enrichedHoldings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No holdings found
                  </TableCell>
                </TableRow>
              ) : (
                enrichedHoldings.map((holding) => (
                  <TableRow key={holding.id}>
                    <TableCell className="font-medium">{holding.investor_code}</TableCell>
                    <TableCell>{holding.investor_name || "-"}</TableCell>
                    <TableCell>{holding.trading_code}</TableCell>
                    <TableCell className="text-right">{formatInteger(holding.total_stock)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.close_price)}</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(holding.live_value)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.ledger_balance)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.market_value)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          Showing {enrichedHoldings.length} holdings
        </p>
      </CardContent>
    </Card>
  );
}
