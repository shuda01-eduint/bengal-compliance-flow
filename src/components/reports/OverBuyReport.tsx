import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Download, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ClientOverBuyData {
  inv_code: string;
  investor_name: string;
  rm_name: string;
  rm_email: string | null;
  ledger_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  adjusted_balance: number;
  net_buy: number;
  net_sell: number;
  net_position: number; // net_buy - net_sell
  violation_amount: number;
  is_violation: boolean;
}

export function OverBuyReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ClientOverBuyData[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRm, setSelectedRm] = useState<string>("all");
  const [showViolationsOnly, setShowViolationsOnly] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch clients
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("inv_code, investor_name, rm_name, rm_email, ledger_balance");

      if (clientsError) throw clientsError;

      // Fetch deposits/withdrawals
      const { data: transactions, error: txError } = await supabase
        .from("deposits_withdrawals")
        .select("investor_code, transaction_type, amount");

      if (txError) throw txError;

      // Fetch trade history for buy/sell calculations
      const { data: trades, error: tradesError } = await supabase
        .from("trade_history")
        .select("client_code, side, value");

      if (tradesError) throw tradesError;

      // Group deposits/withdrawals by investor_code
      const txByInvestor = new Map<string, { deposits: number; withdrawals: number }>();
      transactions?.forEach((tx) => {
        const current = txByInvestor.get(tx.investor_code) || { deposits: 0, withdrawals: 0 };
        if (tx.transaction_type === "Deposit") {
          current.deposits += Number(tx.amount) || 0;
        } else if (tx.transaction_type === "Withdrawal") {
          current.withdrawals += Number(tx.amount) || 0;
        }
        txByInvestor.set(tx.investor_code, current);
      });

      // Group trades by client_code
      const tradesByClient = new Map<string, { buy: number; sell: number }>();
      trades?.forEach((trade) => {
        if (!trade.client_code) return;
        const current = tradesByClient.get(trade.client_code) || { buy: 0, sell: 0 };
        const value = Number(trade.value) || 0;
        if (trade.side?.toLowerCase() === "buy") {
          current.buy += value;
        } else if (trade.side?.toLowerCase() === "sell") {
          current.sell += value;
        }
        tradesByClient.set(trade.client_code, current);
      });

      // Combine data
      const combinedData: ClientOverBuyData[] = (clients || []).map((client) => {
        const tx = txByInvestor.get(client.inv_code) || { deposits: 0, withdrawals: 0 };
        const trades = tradesByClient.get(client.inv_code) || { buy: 0, sell: 0 };
        
        const ledger_balance = Number(client.ledger_balance) || 0;
        const total_deposits = tx.deposits;
        const total_withdrawals = tx.withdrawals;
        const adjusted_balance = ledger_balance + total_deposits - total_withdrawals;
        const net_buy = trades.buy;
        const net_sell = trades.sell;
        const net_position = net_buy - net_sell;
        const violation_amount = Math.max(0, net_position - adjusted_balance);
        const is_violation = net_position > adjusted_balance && adjusted_balance >= 0;

        return {
          inv_code: client.inv_code,
          investor_name: client.investor_name,
          rm_name: client.rm_name,
          rm_email: client.rm_email,
          ledger_balance,
          total_deposits,
          total_withdrawals,
          adjusted_balance,
          net_buy,
          net_sell,
          net_position,
          violation_amount,
          is_violation,
        };
      });

      setData(combinedData);
    } catch (error) {
      console.error("Error fetching overbuy data:", error);
      toast.error("Failed to load overbuy report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Get unique RMs for filter
  const rmOptions = useMemo(() => {
    const unique = [...new Set(data.map((d) => d.rm_name).filter(Boolean))];
    return unique.sort();
  }, [data]);

  // Filter data
  const filteredData = useMemo(() => {
    let result = data;

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.inv_code.toLowerCase().includes(searchLower) ||
          d.investor_name.toLowerCase().includes(searchLower)
      );
    }

    if (selectedRm !== "all") {
      result = result.filter((d) => d.rm_name === selectedRm);
    }

    if (showViolationsOnly) {
      result = result.filter((d) => d.is_violation);
    }

    return result;
  }, [data, search, selectedRm, showViolationsOnly]);

  // Summary stats
  const stats = useMemo(() => {
    const violations = filteredData.filter((d) => d.is_violation);
    const totalViolationAmount = violations.reduce((sum, d) => sum + d.violation_amount, 0);
    return {
      totalClients: filteredData.length,
      violationCount: violations.length,
      totalViolationAmount,
    };
  }, [filteredData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleExport = () => {
    const exportData = filteredData.map((d) => ({
      "Inv Code": d.inv_code,
      "Investor Name": d.investor_name,
      "RM Name": d.rm_name,
      "Ledger Balance": d.ledger_balance,
      "Total Deposits": d.total_deposits,
      "Total Withdrawals": d.total_withdrawals,
      "Adjusted Balance": d.adjusted_balance,
      "Net Buy": d.net_buy,
      "Net Sell": d.net_sell,
      "Net Position": d.net_position,
      "Violation Amount": d.violation_amount,
      "Status": d.is_violation ? "VIOLATION" : "OK",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OverBuy Report");
    XLSX.writeFile(wb, `overbuy_report_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Report exported successfully");
  };

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            OverBuy Compliance Report
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor accounts where net buy exceeds adjusted ledger balance
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-secondary/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Total Clients</p>
            <p className="text-2xl font-bold">{stats.totalClients}</p>
          </div>
          <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
            <p className="text-sm text-muted-foreground">Violations</p>
            <p className="text-2xl font-bold text-destructive">{stats.violationCount}</p>
          </div>
          <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
            <p className="text-sm text-muted-foreground">Total Violation Amount</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(stats.totalViolationAmount)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedRm} onValueChange={setSelectedRm}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by RM" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All RMs</SelectItem>
              {rmOptions.map((rm) => (
                <SelectItem key={rm} value={rm}>
                  {rm}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={showViolationsOnly ? "default" : "outline"}
            onClick={() => setShowViolationsOnly(!showViolationsOnly)}
            className="whitespace-nowrap"
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            {showViolationsOnly ? "Show All" : "Violations Only"}
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inv Code</TableHead>
                <TableHead>Investor Name</TableHead>
                <TableHead>RM</TableHead>
                <TableHead className="text-right">Ledger Balance</TableHead>
                <TableHead className="text-right">Deposits</TableHead>
                <TableHead className="text-right">Withdrawals</TableHead>
                <TableHead className="text-right">Adjusted Balance</TableHead>
                <TableHead className="text-right">Net Buy</TableHead>
                <TableHead className="text-right">Net Sell</TableHead>
                <TableHead className="text-right">Net Position</TableHead>
                <TableHead className="text-right">Violation</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 12 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    No data found
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.slice(0, 100).map((row) => (
                  <TableRow
                    key={row.inv_code}
                    className={row.is_violation ? "bg-destructive/5" : ""}
                  >
                    <TableCell className="font-mono text-sm">{row.inv_code}</TableCell>
                    <TableCell>{row.investor_name}</TableCell>
                    <TableCell>{row.rm_name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.ledger_balance)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-green-600">
                      {formatCurrency(row.total_deposits)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-red-600">
                      {formatCurrency(row.total_withdrawals)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(row.adjusted_balance)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.net_buy)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.net_sell)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatCurrency(row.net_position)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive font-bold">
                      {row.is_violation ? formatCurrency(row.violation_amount) : "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.is_violation ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Violation
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                          <CheckCircle className="h-3 w-3" />
                          OK
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {filteredData.length > 100 && (
          <p className="text-sm text-muted-foreground text-center">
            Showing first 100 of {filteredData.length} records. Use filters to narrow results.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
