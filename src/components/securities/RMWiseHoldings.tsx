import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Download, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import * as XLSX from "xlsx";

interface StockDetail {
  trading_code: string;
  investor_code: string;
  investor_name: string | null;
  total_stock: number | null;
  avg_cost: number | null;
  total_cost: number | null;
  market_value: number | null;
}

interface RMSummary {
  rm_email: string;
  total_quantity: number;
  total_cost: number;
  total_market_value: number;
  client_count: number;
  stock_count: number;
  holdings: StockDetail[];
}

export function RMWiseHoldings() {
  const [summaries, setSummaries] = useState<RMSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedRMs, setExpandedRMs] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchRMWiseData();
  }, [searchTerm]);

  const fetchRMWiseData = async () => {
    setLoading(true);
    try {
      let query = supabase.from("holdings").select("*");

      if (searchTerm) {
        query = query.ilike("rm_email", `%${searchTerm}%`);
      }

      const { data, error } = await query.order("rm_email", { ascending: true });

      if (error) throw error;

      // Group by rm_email
      const grouped = (data || []).reduce((acc: Record<string, RMSummary>, holding) => {
        const rm = holding.rm_email || "Unassigned";
        if (!acc[rm]) {
          acc[rm] = {
            rm_email: rm,
            total_quantity: 0,
            total_cost: 0,
            total_market_value: 0,
            client_count: 0,
            stock_count: 0,
            holdings: [],
          };
        }
        acc[rm].total_quantity += holding.total_stock || 0;
        acc[rm].total_cost += holding.total_cost || 0;
        acc[rm].total_market_value += holding.market_value || 0;
        acc[rm].stock_count += 1;
        acc[rm].holdings.push({
          trading_code: holding.trading_code,
          investor_code: holding.investor_code,
          investor_name: holding.investor_name,
          total_stock: holding.total_stock,
          avg_cost: holding.avg_cost,
          total_cost: holding.total_cost,
          market_value: holding.market_value,
        });
        return acc;
      }, {});

      // Calculate unique client count per RM
      Object.values(grouped).forEach((rm) => {
        const uniqueClients = new Set(rm.holdings.map((h) => h.investor_code));
        rm.client_count = uniqueClients.size;
      });

      setSummaries(Object.values(grouped));
    } catch (error) {
      console.error("Error fetching RM-wise data:", error);
      toast({
        title: "Error",
        description: "Failed to fetch RM-wise holdings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (rm: string) => {
    setExpandedRMs((prev) => {
      const next = new Set(prev);
      if (next.has(rm)) {
        next.delete(rm);
      } else {
        next.add(rm);
      }
      return next;
    });
  };

  const handleExport = () => {
    const exportData: any[] = [];
    summaries.forEach((summary) => {
      // Summary row
      exportData.push({
        "RM Email": summary.rm_email,
        "Type": "SUMMARY",
        "Total Quantity": summary.total_quantity,
        "Total Cost": summary.total_cost,
        "Total Market Value": summary.total_market_value,
        "Client Count": summary.client_count,
        "Stock Holdings": summary.stock_count,
      });
      // Detail rows
      summary.holdings.forEach((h) => {
        exportData.push({
          "RM Email": summary.rm_email,
          "Type": "DETAIL",
          "Trading Code": h.trading_code,
          "Investor Code": h.investor_code,
          "Investor Name": h.investor_name,
          "Quantity": h.total_stock,
          "Avg Cost": h.avg_cost,
          "Total Cost": h.total_cost,
          "Market Value": h.market_value,
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RM-wise Holdings");
    XLSX.writeFile(wb, `rm_wise_holdings_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const formatNumber = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatInteger = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString("en-US");
  };

  const grandTotals = summaries.reduce(
    (acc, s) => ({
      quantity: acc.quantity + s.total_quantity,
      cost: acc.cost + s.total_cost,
      marketValue: acc.marketValue + s.total_market_value,
      clients: acc.clients + s.client_count,
      stocks: acc.stocks + s.stock_count,
    }),
    { quantity: 0, cost: 0, marketValue: 0, clients: 0, stocks: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">RM-wise Holdings</CardTitle>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={summaries.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by RM email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); setSearchTerm(""); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total RMs</div>
            <div className="text-2xl font-bold">{summaries.length.toLocaleString()}</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total Clients</div>
            <div className="text-2xl font-bold">{grandTotals.clients.toLocaleString()}</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total Quantity</div>
            <div className="text-2xl font-bold">{formatInteger(grandTotals.quantity)}</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total Cost</div>
            <div className="text-2xl font-bold">{formatNumber(grandTotals.cost)}</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total Market Value</div>
            <div className="text-2xl font-bold">{formatNumber(grandTotals.marketValue)}</div>
          </div>
        </div>

        {/* Results count */}
        <div className="text-sm text-muted-foreground">
          Showing {summaries.length} RMs with {grandTotals.stocks.toLocaleString()} total stock holdings
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead className="min-w-[200px]">RM Email</TableHead>
                <TableHead className="min-w-[100px] text-right">Clients</TableHead>
                <TableHead className="min-w-[100px] text-right">Holdings</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Quantity</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Cost</TableHead>
                <TableHead className="min-w-[120px] text-right">Market Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : summaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No holdings data found.
                  </TableCell>
                </TableRow>
              ) : (
                summaries.map((summary) => (
                  <Collapsible key={summary.rm_email} asChild open={expandedRMs.has(summary.rm_email)}>
                    <>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(summary.rm_email)}>
                        <TableCell>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="p-0 h-6 w-6">
                              {expandedRMs.has(summary.rm_email) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                        <TableCell className="font-medium">{summary.rm_email}</TableCell>
                        <TableCell className="text-right">{summary.client_count}</TableCell>
                        <TableCell className="text-right">{summary.stock_count}</TableCell>
                        <TableCell className="text-right">{formatInteger(summary.total_quantity)}</TableCell>
                        <TableCell className="text-right">{formatNumber(summary.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatNumber(summary.total_market_value)}</TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={7} className="p-0">
                            <div className="bg-muted/30 p-4 max-h-[400px] overflow-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Trading Code</TableHead>
                                    <TableHead>Investor Code</TableHead>
                                    <TableHead>Investor Name</TableHead>
                                    <TableHead className="text-right">Quantity</TableHead>
                                    <TableHead className="text-right">Avg Cost</TableHead>
                                    <TableHead className="text-right">Total Cost</TableHead>
                                    <TableHead className="text-right">Market Value</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {summary.holdings.map((h, idx) => (
                                    <TableRow key={`${summary.rm_email}-${h.trading_code}-${h.investor_code}-${idx}`}>
                                      <TableCell className="font-medium">{h.trading_code}</TableCell>
                                      <TableCell>{h.investor_code}</TableCell>
                                      <TableCell>{h.investor_name || "-"}</TableCell>
                                      <TableCell className="text-right">{formatInteger(h.total_stock)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.avg_cost)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.total_cost)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.market_value)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
