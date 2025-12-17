import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Download, X, Upload, FileSpreadsheet, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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

interface DepositWithdrawal {
  id: string;
  investor_code: string;
  investor_name: string | null;
  transaction_type: string;
  amount: number;
  transaction_date: string;
  remarks: string | null;
  rm_email: string | null;
}

export function PortfolioReports() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [rmFilter, setRmFilter] = useState<string>("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        query = query.or(`investor_code.eq.${debouncedSearch},trading_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%`);
      }

      if (rmFilter && rmFilter !== "all") {
        query = query.eq("rm_email", rmFilter);
      }

      const { data, error } = await query.limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch deposits/withdrawals
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ["deposits-withdrawals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deposits_withdrawals")
        .select("*")
        .order("transaction_date", { ascending: false });
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

  const parseNumericValue = (value: unknown): number => {
    if (value === null || value === undefined || value === "") return 0;
    const str = String(value).replace(/,/g, "").trim();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error("No data found in file");
        return;
      }

      // Map columns (flexible column names)
      const records = jsonData.map((row: any) => {
        const invCode = row["Investor Code"] || row["investor_code"] || row["InvCode"] || row["inv_code"] || "";
        const invName = row["Investor Name"] || row["investor_name"] || row["Name"] || "";
        const type = row["Type"] || row["transaction_type"] || row["Transaction Type"] || "deposit";
        const amount = parseNumericValue(row["Amount"] || row["amount"] || 0);
        const date = row["Date"] || row["transaction_date"] || row["Transaction Date"] || new Date().toISOString().split("T")[0];
        const remarks = row["Remarks"] || row["remarks"] || row["Notes"] || "";
        const rmEmail = row["RM Email"] || row["rm_email"] || "";

        return {
          investor_code: String(invCode).trim(),
          investor_name: String(invName).trim() || null,
          transaction_type: String(type).toLowerCase().includes("withdraw") ? "withdrawal" : "deposit",
          amount: Math.abs(amount),
          transaction_date: date,
          remarks: remarks || null,
          rm_email: rmEmail || null,
        };
      }).filter((r) => r.investor_code);

      if (records.length === 0) {
        toast.error("No valid records found. Ensure 'Investor Code' column exists.");
        return;
      }

      // Insert in batches
      const batchSize = 500;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("deposits_withdrawals").insert(batch);
        if (error) throw error;
      }

      toast.success(`Imported ${records.length} transactions`);
      queryClient.invalidateQueries({ queryKey: ["deposits-withdrawals"] });
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error(error.message || "Failed to import file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClearTransactions = async () => {
    if (!confirm("Are you sure you want to clear all deposit/withdrawal records?")) return;

    try {
      const { error } = await supabase.from("deposits_withdrawals").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      toast.success("Cleared all transactions");
      queryClient.invalidateQueries({ queryKey: ["deposits-withdrawals"] });
    } catch (error: any) {
      toast.error(error.message || "Failed to clear transactions");
    }
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

  const transactionTotals = transactions.reduce(
    (acc, t) => ({
      deposits: acc.deposits + (t.transaction_type === "deposit" ? t.amount : 0),
      withdrawals: acc.withdrawals + (t.transaction_type === "withdrawal" ? t.amount : 0),
    }),
    { deposits: 0, withdrawals: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Reports</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="holdings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="holdings">Holdings Report</TabsTrigger>
            <TabsTrigger value="transactions">Deposits/Withdrawals</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="space-y-4">
            {/* Holdings Header */}
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4 flex-1">
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
                  <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRmFilter("all"); }}>
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              <Button onClick={handleExport} variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>

            {/* Holdings Summary */}
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

            {/* Holdings Table */}
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
                      <TableCell colSpan={8} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : enrichedHoldings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No holdings found</TableCell>
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
            <p className="text-sm text-muted-foreground">Showing {enrichedHoldings.length} holdings</p>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            {/* Transactions Header */}
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <h3 className="text-lg font-medium">Today's Deposits & Withdrawals</h3>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Import Excel
                </Button>
                {transactions.length > 0 && (
                  <Button onClick={handleClearTransactions} variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Import Instructions */}
            <div className="p-4 bg-muted/50 rounded-lg text-sm">
              <p className="font-medium mb-2">Excel Format:</p>
              <p className="text-muted-foreground">
                Columns: <code>Investor Code</code>, <code>Investor Name</code>, <code>Type</code> (deposit/withdrawal), 
                <code>Amount</code>, <code>Date</code>, <code>Remarks</code>, <code>RM Email</code>
              </p>
            </div>

            {/* Transactions Summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Total Deposits</p>
                <p className="text-lg font-semibold text-green-600">{formatNumber(transactionTotals.deposits)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Withdrawals</p>
                <p className="text-lg font-semibold text-red-600">{formatNumber(transactionTotals.withdrawals)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Flow</p>
                <p className="text-lg font-semibold">{formatNumber(transactionTotals.deposits - transactionTotals.withdrawals)}</p>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="rounded-md border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Investor Code</TableHead>
                    <TableHead>Investor Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactionsLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                  ) : transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        No transactions. Import an Excel file to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.investor_code}</TableCell>
                        <TableCell>{t.investor_name || "-"}</TableCell>
                        <TableCell>
                          <span className={t.transaction_type === "deposit" ? "text-green-600" : "text-red-600"}>
                            {t.transaction_type === "deposit" ? "Deposit" : "Withdrawal"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(t.amount)}</TableCell>
                        <TableCell>{t.transaction_date}</TableCell>
                        <TableCell>{t.remarks || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm text-muted-foreground">Showing {transactions.length} transactions</p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}