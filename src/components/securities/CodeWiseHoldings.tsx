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

interface HoldingDetail {
  investor_code: string;
  investor_name: string | null;
  total_stock: number | null;
  avg_cost: number | null;
  total_cost: number | null;
  market_value: number | null;
  rm_email: string | null;
}

interface CodeSummary {
  trading_code: string;
  total_quantity: number;
  total_cost: number;
  total_market_value: number;
  investor_count: number;
  holdings: HoldingDetail[];
}

export function CodeWiseHoldings() {
  const [summaries, setSummaries] = useState<CodeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchCodeWiseData();
  }, [searchTerm]);

  const fetchCodeWiseData = async () => {
    setLoading(true);
    try {
      let query = supabase.from("holdings").select("*");

      if (searchTerm) {
        query = query.ilike("trading_code", `%${searchTerm}%`);
      }

      const { data, error } = await query.order("trading_code", { ascending: true });

      if (error) throw error;

      // Group by trading_code
      const grouped = (data || []).reduce((acc: Record<string, CodeSummary>, holding) => {
        const code = holding.trading_code;
        if (!acc[code]) {
          acc[code] = {
            trading_code: code,
            total_quantity: 0,
            total_cost: 0,
            total_market_value: 0,
            investor_count: 0,
            holdings: [],
          };
        }
        acc[code].total_quantity += holding.total_stock || 0;
        acc[code].total_cost += holding.total_cost || 0;
        acc[code].total_market_value += holding.market_value || 0;
        acc[code].investor_count += 1;
        acc[code].holdings.push({
          investor_code: holding.investor_code,
          investor_name: holding.investor_name,
          total_stock: holding.total_stock,
          avg_cost: holding.avg_cost,
          total_cost: holding.total_cost,
          market_value: holding.market_value,
          rm_email: holding.rm_email,
        });
        return acc;
      }, {});

      setSummaries(Object.values(grouped));
    } catch (error) {
      console.error("Error fetching code-wise data:", error);
      toast({
        title: "Error",
        description: "Failed to fetch code-wise holdings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleExport = () => {
    const exportData: any[] = [];
    summaries.forEach((summary) => {
      // Summary row
      exportData.push({
        "Trading Code": summary.trading_code,
        "Type": "SUMMARY",
        "Total Quantity": summary.total_quantity,
        "Total Cost": summary.total_cost,
        "Total Market Value": summary.total_market_value,
        "Investor Count": summary.investor_count,
      });
      // Detail rows
      summary.holdings.forEach((h) => {
        exportData.push({
          "Trading Code": summary.trading_code,
          "Type": "DETAIL",
          "Investor Code": h.investor_code,
          "Investor Name": h.investor_name,
          "Quantity": h.total_stock,
          "Avg Cost": h.avg_cost,
          "Total Cost": h.total_cost,
          "Market Value": h.market_value,
          "RM Email": h.rm_email,
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Code-wise Holdings");
    XLSX.writeFile(wb, `code_wise_holdings_${new Date().toISOString().split("T")[0]}.xlsx`);
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
      investors: acc.investors + s.investor_count,
    }),
    { quantity: 0, cost: 0, marketValue: 0, investors: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">Code-wise Holdings</CardTitle>
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
              placeholder="Search by trading code..."
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Total Securities</div>
            <div className="text-2xl font-bold">{summaries.length.toLocaleString()}</div>
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
          Showing {summaries.length} securities with {grandTotals.investors.toLocaleString()} total holdings
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead className="min-w-[150px]">Trading Code</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Quantity</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Cost</TableHead>
                <TableHead className="min-w-[120px] text-right">Market Value</TableHead>
                <TableHead className="min-w-[100px] text-right">Investors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : summaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No holdings data found.
                  </TableCell>
                </TableRow>
              ) : (
                summaries.map((summary) => (
                  <Collapsible key={summary.trading_code} asChild open={expandedCodes.has(summary.trading_code)}>
                    <>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(summary.trading_code)}>
                        <TableCell>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="p-0 h-6 w-6">
                              {expandedCodes.has(summary.trading_code) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                        <TableCell className="font-medium">{summary.trading_code}</TableCell>
                        <TableCell className="text-right">{formatInteger(summary.total_quantity)}</TableCell>
                        <TableCell className="text-right">{formatNumber(summary.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatNumber(summary.total_market_value)}</TableCell>
                        <TableCell className="text-right">{summary.investor_count}</TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={6} className="p-0">
                            <div className="bg-muted/30 p-4">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Investor Code</TableHead>
                                    <TableHead>Investor Name</TableHead>
                                    <TableHead className="text-right">Quantity</TableHead>
                                    <TableHead className="text-right">Avg Cost</TableHead>
                                    <TableHead className="text-right">Total Cost</TableHead>
                                    <TableHead className="text-right">Market Value</TableHead>
                                    <TableHead>RM Email</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {summary.holdings.map((h, idx) => (
                                    <TableRow key={`${summary.trading_code}-${h.investor_code}-${idx}`}>
                                      <TableCell>{h.investor_code}</TableCell>
                                      <TableCell>{h.investor_name || "-"}</TableCell>
                                      <TableCell className="text-right">{formatInteger(h.total_stock)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.avg_cost)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.total_cost)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(h.market_value)}</TableCell>
                                      <TableCell>{h.rm_email || "-"}</TableCell>
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
