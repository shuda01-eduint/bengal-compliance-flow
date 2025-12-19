import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Download, RefreshCw, Building2, CalendarIcon, ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Settings, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface MerchantBank {
  id: string;
  prefix: string;
  bank_name: string;
  description: string | null;
}

interface MerchantCodeData {
  client_code: string;
  trade_count: number;
  buy_value: number;
  sell_value: number;
  buy_quantity: number;
  sell_quantity: number;
  net_value: number;
  first_trade_date: string | null;
  last_trade_date: string | null;
  securities: { code: string; buy: number; sell: number; net: number }[];
}

interface MerchantBankData {
  prefix: string;
  bank_name: string;
  codes: MerchantCodeData[];
  total_buy: number;
  total_sell: number;
  total_net: number;
  total_trades: number;
}

export function MerchantBankReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MerchantBankData[]>([]);
  const [merchantBanks, setMerchantBanks] = useState<MerchantBank[]>([]);
  const [search, setSearch] = useState("");
  const [selectedBank, setSelectedBank] = useState<string>("all");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [expandedBanks, setExpandedBanks] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<string>("net_value");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<MerchantBank | null>(null);
  const [newBank, setNewBank] = useState({ prefix: "", bank_name: "", description: "" });
  const [savingBank, setSavingBank] = useState(false);

  // Fetch merchant bank mappings from database
  const fetchMerchantBanks = async () => {
    const { data, error } = await supabase
      .from("merchant_banks")
      .select("*")
      .order("prefix");
    
    if (!error && data) {
      setMerchantBanks(data);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch bank mappings first
      await fetchMerchantBanks();
      
      // Get all client codes that exist in clients table
      const { data: existingClients } = await supabase
        .from("clients")
        .select("inv_code");
      
      const existingCodes = new Set(existingClients?.map(c => c.inv_code) || []);

      // Build trade query with date filters
      let tradeQuery = supabase
        .from("trade_history")
        .select("client_code, side, value, quantity, security_code, trade_date, file_name");
      
      if (startDate) {
        tradeQuery = tradeQuery.gte("trade_date", format(startDate, "yyyy-MM-dd"));
      }
      if (endDate) {
        tradeQuery = tradeQuery.lte("trade_date", format(endDate, "yyyy-MM-dd"));
      }

      const { data: trades, error } = await tradeQuery;

      if (error) throw error;

      // Filter to only merchant bank codes (not in clients table)
      const merchantTrades = (trades || []).filter(
        t => t.client_code && !existingCodes.has(t.client_code)
      );

      // Group by prefix and client_code
      const bankMap = new Map<string, Map<string, MerchantCodeData>>();

      merchantTrades.forEach(trade => {
        const code = trade.client_code!;
        const prefix = code.replace(/[0-9]+$/, '');
        
        if (!bankMap.has(prefix)) {
          bankMap.set(prefix, new Map());
        }
        
        const codesMap = bankMap.get(prefix)!;
        if (!codesMap.has(code)) {
          codesMap.set(code, {
            client_code: code,
            trade_count: 0,
            buy_value: 0,
            sell_value: 0,
            buy_quantity: 0,
            sell_quantity: 0,
            net_value: 0,
            first_trade_date: null,
            last_trade_date: null,
            securities: [],
          });
        }

        const codeData = codesMap.get(code)!;
        const value = Number(trade.value) || 0;
        const quantity = Number(trade.quantity) || 0;
        const isBuy = trade.side?.toLowerCase() === "buy";

        codeData.trade_count++;
        if (isBuy) {
          codeData.buy_value += value;
          codeData.buy_quantity += quantity;
        } else if (trade.side?.toLowerCase() === "sell") {
          codeData.sell_value += value;
          codeData.sell_quantity += quantity;
        }
        codeData.net_value = codeData.buy_value - codeData.sell_value;

        // Track date range
        if (trade.trade_date) {
          if (!codeData.first_trade_date || trade.trade_date < codeData.first_trade_date) {
            codeData.first_trade_date = trade.trade_date;
          }
          if (!codeData.last_trade_date || trade.trade_date > codeData.last_trade_date) {
            codeData.last_trade_date = trade.trade_date;
          }
        }

        // Track securities
        if (trade.security_code) {
          let sec = codeData.securities.find(s => s.code === trade.security_code);
          if (!sec) {
            sec = { code: trade.security_code, buy: 0, sell: 0, net: 0 };
            codeData.securities.push(sec);
          }
          if (isBuy) {
            sec.buy += value;
          } else {
            sec.sell += value;
          }
          sec.net = sec.buy - sec.sell;
        }
      });

      // Get bank names from database
      const { data: dbBanks } = await supabase.from("merchant_banks").select("prefix, bank_name");
      const bankNames: Record<string, string> = {};
      dbBanks?.forEach(b => { bankNames[b.prefix] = b.bank_name; });

      // Convert to array format
      const result: MerchantBankData[] = [];
      bankMap.forEach((codesMap, prefix) => {
        const codes = Array.from(codesMap.values());
        result.push({
          prefix,
          bank_name: bankNames[prefix] || `Bank ${prefix}`,
          codes,
          total_buy: codes.reduce((sum, c) => sum + c.buy_value, 0),
          total_sell: codes.reduce((sum, c) => sum + c.sell_value, 0),
          total_net: codes.reduce((sum, c) => sum + c.net_value, 0),
          total_trades: codes.reduce((sum, c) => sum + c.trade_count, 0),
        });
      });

      // Sort by total trades
      result.sort((a, b) => b.total_trades - a.total_trades);

      setData(result);
    } catch (error) {
      console.error("Error fetching merchant bank data:", error);
      toast.error("Failed to load merchant bank report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  // Bank management functions
  const handleSaveBank = async () => {
    if (!newBank.prefix || !newBank.bank_name) {
      toast.error("Prefix and Bank Name are required");
      return;
    }
    
    setSavingBank(true);
    try {
      if (editingBank) {
        // Update existing
        const { error } = await supabase
          .from("merchant_banks")
          .update({ 
            bank_name: newBank.bank_name, 
            description: newBank.description || null 
          })
          .eq("id", editingBank.id);
        
        if (error) throw error;
        toast.success("Bank updated successfully");
      } else {
        // Insert new
        const { error } = await supabase
          .from("merchant_banks")
          .insert({ 
            prefix: newBank.prefix.toUpperCase(), 
            bank_name: newBank.bank_name, 
            description: newBank.description || null 
          });
        
        if (error) {
          if (error.code === "23505") {
            toast.error("A bank with this prefix already exists");
          } else {
            throw error;
          }
          return;
        }
        toast.success("Bank added successfully");
      }
      
      setNewBank({ prefix: "", bank_name: "", description: "" });
      setEditingBank(null);
      await fetchMerchantBanks();
      await fetchData();
    } catch (error) {
      console.error("Error saving bank:", error);
      toast.error("Failed to save bank");
    } finally {
      setSavingBank(false);
    }
  };

  const handleDeleteBank = async (id: string) => {
    if (!confirm("Are you sure you want to delete this bank mapping?")) return;
    
    try {
      const { error } = await supabase
        .from("merchant_banks")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      toast.success("Bank deleted successfully");
      await fetchMerchantBanks();
      await fetchData();
    } catch (error) {
      console.error("Error deleting bank:", error);
      toast.error("Failed to delete bank");
    }
  };

  const handleEditBank = (bank: MerchantBank) => {
    setEditingBank(bank);
    setNewBank({ 
      prefix: bank.prefix, 
      bank_name: bank.bank_name, 
      description: bank.description || "" 
    });
  };

  const bankOptions = useMemo(() => {
    return data
      .filter(d => d.prefix && d.prefix.trim() !== "")
      .map(d => ({ prefix: d.prefix, name: d.bank_name }));
  }, [data]);

  const filteredData = useMemo(() => {
    let result = data;

    if (selectedBank !== "all") {
      result = result.filter(d => d.prefix === selectedBank);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.map(bank => ({
        ...bank,
        codes: bank.codes.filter(c => 
          c.client_code.toLowerCase().includes(searchLower)
        )
      })).filter(bank => bank.codes.length > 0);
    }

    // Sort codes within each bank
    if (sortColumn) {
      result = result.map(bank => ({
        ...bank,
        codes: [...bank.codes].sort((a, b) => {
          const aVal = a[sortColumn as keyof MerchantCodeData] as number;
          const bVal = b[sortColumn as keyof MerchantCodeData] as number;
          return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
        })
      }));
    }

    return result;
  }, [data, search, selectedBank, sortColumn, sortDirection]);

  const totals = useMemo(() => {
    return {
      banks: filteredData.length,
      codes: filteredData.reduce((sum, b) => sum + b.codes.length, 0),
      trades: filteredData.reduce((sum, b) => sum + b.total_trades, 0),
      buy: filteredData.reduce((sum, b) => sum + b.total_buy, 0),
      sell: filteredData.reduce((sum, b) => sum + b.total_sell, 0),
      net: filteredData.reduce((sum, b) => sum + b.total_net, 0),
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

  const toggleBank = (prefix: string) => {
    setExpandedBanks(prev => {
      const next = new Set(prev);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const handleExport = () => {
    const exportData: any[] = [];
    
    filteredData.forEach(bank => {
      bank.codes.forEach(code => {
        exportData.push({
          "Bank": bank.bank_name,
          "Prefix": bank.prefix,
          "Code": code.client_code,
          "Trades": code.trade_count,
          "Buy Value": code.buy_value,
          "Sell Value": code.sell_value,
          "Net Value": code.net_value,
          "Buy Qty": code.buy_quantity,
          "Sell Qty": code.sell_quantity,
          "First Trade": code.first_trade_date,
          "Last Trade": code.last_trade_date,
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Merchant Bank Report");
    XLSX.writeFile(wb, `merchant_bank_report_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Report exported successfully");
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <>
      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Manage Merchant Banks
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Add/Edit Form */}
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-medium mb-3">{editingBank ? "Edit Bank" : "Add New Bank"}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>Prefix</Label>
                    <Input
                      value={newBank.prefix}
                      onChange={(e) => setNewBank(prev => ({ ...prev, prefix: e.target.value.toUpperCase() }))}
                      placeholder="e.g., CL"
                      disabled={!!editingBank}
                      maxLength={10}
                    />
                  </div>
                  <div>
                    <Label>Bank Name</Label>
                    <Input
                      value={newBank.bank_name}
                      onChange={(e) => setNewBank(prev => ({ ...prev, bank_name: e.target.value }))}
                      placeholder="e.g., Community Bank"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={newBank.description}
                      onChange={(e) => setNewBank(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button onClick={handleSaveBank} disabled={savingBank} size="sm">
                    {savingBank ? "Saving..." : editingBank ? "Update" : "Add Bank"}
                  </Button>
                  {editingBank && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setEditingBank(null);
                        setNewBank({ prefix: "", bank_name: "", description: "" });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Existing Banks List */}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Bank Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merchantBanks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                        No banks configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    merchantBanks.map((bank) => (
                      <TableRow key={bank.id}>
                        <TableCell className="font-mono font-bold">{bank.prefix}</TableCell>
                        <TableCell>{bank.bank_name}</TableCell>
                        <TableCell className="text-muted-foreground">{bank.description || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditBank(bank)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive"
                              onClick={() => handleDeleteBank(bank.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Merchant Bank Report
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Trade summaries for merchant bank accounts by prefix
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
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
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Banks</p>
            <p className="text-xl font-bold">{totals.banks}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Codes</p>
            <p className="text-xl font-bold">{totals.codes}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="text-xl font-bold">{totals.trades.toLocaleString()}</p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/20">
            <p className="text-xs text-muted-foreground">Total Buy</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totals.buy)}</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <p className="text-xs text-muted-foreground">Total Sell</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(totals.sell)}</p>
          </div>
          <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
            <p className="text-xs text-muted-foreground">Net Position</p>
            <p className={cn("text-lg font-bold", totals.net >= 0 ? "text-green-600" : "text-red-600")}>
              {formatCurrency(totals.net)}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          
          {/* Date Range Filters */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "dd/MM/yy") : "Start"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "dd/MM/yy") : "End"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          
          {(startDate || endDate) && (
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(undefined); setEndDate(undefined); }}>
              Clear
            </Button>
          )}
          
          <Select value={selectedBank} onValueChange={setSelectedBank}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by Bank" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Banks</SelectItem>
              {bankOptions.map((bank) => (
                <SelectItem key={bank.prefix} value={bank.prefix}>
                  {bank.name} ({bank.prefix})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bank Cards */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No merchant bank trades found
          </div>
        ) : (
          <div className="space-y-4">
            {filteredData.map((bank) => (
              <Collapsible
                key={bank.prefix}
                open={expandedBanks.has(bank.prefix)}
                onOpenChange={() => toggleBank(bank.prefix)}
              >
                <CollapsibleTrigger asChild>
                  <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {expandedBanks.has(bank.prefix) ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronRight className="h-5 w-5" />
                          )}
                          <div>
                            <h3 className="font-semibold">{bank.bank_name}</h3>
                            <p className="text-sm text-muted-foreground">
                              Prefix: {bank.prefix} • {bank.codes.length} codes • {bank.total_trades.toLocaleString()} trades
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-6 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">Buy</p>
                            <p className="font-mono text-green-600">{formatCurrency(bank.total_buy)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Sell</p>
                            <p className="font-mono text-red-600">{formatCurrency(bank.total_sell)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Net</p>
                            <p className={cn("font-mono font-bold", bank.total_net >= 0 ? "text-green-600" : "text-red-600")}>
                              {formatCurrency(bank.total_net)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-lg border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead 
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleSort("trade_count")}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Trades <SortIcon column="trade_count" />
                            </div>
                          </TableHead>
                          <TableHead 
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleSort("buy_value")}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Buy Value <SortIcon column="buy_value" />
                            </div>
                          </TableHead>
                          <TableHead 
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleSort("sell_value")}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Sell Value <SortIcon column="sell_value" />
                            </div>
                          </TableHead>
                          <TableHead 
                            className="text-right cursor-pointer hover:bg-muted/50"
                            onClick={() => handleSort("net_value")}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Net Value <SortIcon column="net_value" />
                            </div>
                          </TableHead>
                          <TableHead className="text-center">Date Range</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bank.codes.map((code) => (
                          <TableRow key={code.client_code}>
                            <TableCell className="font-mono font-medium">{code.client_code}</TableCell>
                            <TableCell className="text-right font-mono">{code.trade_count}</TableCell>
                            <TableCell className="text-right font-mono text-green-600">
                              {formatCurrency(code.buy_value)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-red-600">
                              {formatCurrency(code.sell_value)}
                            </TableCell>
                            <TableCell className={cn("text-right font-mono font-bold", code.net_value >= 0 ? "text-green-600" : "text-red-600")}>
                              {formatCurrency(code.net_value)}
                            </TableCell>
                            <TableCell className="text-center text-sm text-muted-foreground">
                              {code.first_trade_date && code.last_trade_date ? (
                                `${code.first_trade_date} - ${code.last_trade_date}`
                              ) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
      </Card>
    </>
  );
}
