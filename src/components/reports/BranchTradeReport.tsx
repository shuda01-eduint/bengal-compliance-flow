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
import { Search, Download, RefreshCw, GitBranch, CalendarIcon, ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Settings, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface BranchCode {
  id: string;
  prefix: string;
  branch_name: string;
  branch_type: string | null;
  description: string | null;
}

interface BranchCodeData {
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

interface BranchData {
  prefix: string;
  branch_name: string;
  branch_type: string;
  codes: BranchCodeData[];
  total_buy: number;
  total_sell: number;
  total_net: number;
  total_trades: number;
}

export function BranchTradeReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BranchData[]>([]);
  const [branchCodes, setBranchCodes] = useState<BranchCode[]>([]);
  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<string>("net_value");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchCode | null>(null);
  const [newBranch, setNewBranch] = useState({ prefix: "", branch_name: "", branch_type: "outlet", description: "" });
  const [savingBranch, setSavingBranch] = useState(false);

  // Fetch branch code mappings from database
  const fetchBranchCodes = async () => {
    const { data, error } = await supabase
      .from("branch_codes")
      .select("*")
      .order("prefix");
    
    if (!error && data) {
      setBranchCodes(data);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch branch mappings first
      await fetchBranchCodes();
      
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

      // Filter to only branch codes (not in clients table)
      const branchTrades = (trades || []).filter(
        t => t.client_code && !existingCodes.has(t.client_code)
      );

      // Group by prefix and client_code
      const branchMap = new Map<string, Map<string, BranchCodeData>>();

      branchTrades.forEach(trade => {
        const code = trade.client_code!;
        const prefix = code.replace(/[0-9]+$/, '');
        
        if (!branchMap.has(prefix)) {
          branchMap.set(prefix, new Map());
        }
        
        const codesMap = branchMap.get(prefix)!;
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

      // Get branch names from database
      const { data: dbBranches } = await supabase.from("branch_codes").select("prefix, branch_name, branch_type");
      const branchNames: Record<string, { name: string; type: string }> = {};
      dbBranches?.forEach(b => { branchNames[b.prefix] = { name: b.branch_name, type: b.branch_type || 'outlet' }; });

      // Convert to array format
      const result: BranchData[] = [];
      branchMap.forEach((codesMap, prefix) => {
        const codes = Array.from(codesMap.values());
        const branchInfo = branchNames[prefix] || { name: `Branch ${prefix || 'Direct'}`, type: 'outlet' };
        result.push({
          prefix,
          branch_name: branchInfo.name,
          branch_type: branchInfo.type,
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
      console.error("Error fetching branch trade data:", error);
      toast.error("Failed to load branch trade report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  // Branch management functions
  const handleSaveBranch = async () => {
    if (!newBranch.prefix || !newBranch.branch_name) {
      toast.error("Prefix and Branch Name are required");
      return;
    }
    
    setSavingBranch(true);
    try {
      if (editingBranch) {
        // Update existing
        const { error } = await supabase
          .from("branch_codes")
          .update({ 
            branch_name: newBranch.branch_name,
            branch_type: newBranch.branch_type,
            description: newBranch.description || null 
          })
          .eq("id", editingBranch.id);
        
        if (error) throw error;
        toast.success("Branch updated successfully");
      } else {
        // Insert new
        const { error } = await supabase
          .from("branch_codes")
          .insert({ 
            prefix: newBranch.prefix.toUpperCase(), 
            branch_name: newBranch.branch_name,
            branch_type: newBranch.branch_type,
            description: newBranch.description || null 
          });
        
        if (error) {
          if (error.code === "23505") {
            toast.error("A branch with this prefix already exists");
          } else {
            throw error;
          }
          return;
        }
        toast.success("Branch added successfully");
      }
      
      setNewBranch({ prefix: "", branch_name: "", branch_type: "outlet", description: "" });
      setEditingBranch(null);
      await fetchBranchCodes();
      await fetchData();
    } catch (error) {
      console.error("Error saving branch:", error);
      toast.error("Failed to save branch");
    } finally {
      setSavingBranch(false);
    }
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm("Are you sure you want to delete this branch mapping?")) return;
    
    try {
      const { error } = await supabase
        .from("branch_codes")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      toast.success("Branch deleted successfully");
      await fetchBranchCodes();
      await fetchData();
    } catch (error) {
      console.error("Error deleting branch:", error);
      toast.error("Failed to delete branch");
    }
  };

  const handleEditBranch = (branch: BranchCode) => {
    setEditingBranch(branch);
    setNewBranch({ 
      prefix: branch.prefix, 
      branch_name: branch.branch_name,
      branch_type: branch.branch_type || "outlet",
      description: branch.description || "" 
    });
  };

  const branchOptions = useMemo(() => {
    return data.map(d => ({ prefix: d.prefix, name: d.branch_name }));
  }, [data]);

  const filteredData = useMemo(() => {
    let result = data;

    if (selectedBranch !== "all") {
      result = result.filter(d => d.prefix === selectedBranch);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.map(branch => ({
        ...branch,
        codes: branch.codes.filter(c => 
          c.client_code.toLowerCase().includes(searchLower)
        )
      })).filter(branch => branch.codes.length > 0);
    }

    // Sort codes within each branch
    if (sortColumn) {
      result = result.map(branch => ({
        ...branch,
        codes: [...branch.codes].sort((a, b) => {
          const aVal = a[sortColumn as keyof BranchCodeData] as number;
          const bVal = b[sortColumn as keyof BranchCodeData] as number;
          return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
        })
      }));
    }

    return result;
  }, [data, search, selectedBranch, sortColumn, sortDirection]);

  const totals = useMemo(() => {
    return {
      branches: filteredData.length,
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

  const toggleBranch = (prefix: string) => {
    setExpandedBranches(prev => {
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
    
    filteredData.forEach(branch => {
      branch.codes.forEach(code => {
        exportData.push({
          "Branch": branch.branch_name,
          "Type": branch.branch_type,
          "Prefix": branch.prefix,
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
    XLSX.utils.book_append_sheet(wb, ws, "Branch Trade Report");
    XLSX.writeFile(wb, `branch_trade_report_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Report exported successfully");
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const branchTypeOptions = [
    { value: "head_office", label: "Head Office" },
    { value: "branch", label: "Branch" },
    { value: "extension", label: "Extension Counter" },
    { value: "digital_booth", label: "Digital Booth" },
    { value: "outlet", label: "Outlet" },
  ];

  return (
    <>
      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Manage Branch Codes
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Add/Edit Form */}
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-medium mb-3">{editingBranch ? "Edit Branch" : "Add New Branch"}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Prefix</Label>
                    <Input
                      value={newBranch.prefix}
                      onChange={(e) => setNewBranch(prev => ({ ...prev, prefix: e.target.value.toUpperCase() }))}
                      placeholder="e.g., KL, MR, OBO"
                      disabled={!!editingBranch}
                      maxLength={10}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Leave empty for direct/head office codes</p>
                  </div>
                  <div>
                    <Label>Branch Name</Label>
                    <Input
                      value={newBranch.branch_name}
                      onChange={(e) => setNewBranch(prev => ({ ...prev, branch_name: e.target.value }))}
                      placeholder="e.g., Khulna Branch"
                    />
                  </div>
                  <div>
                    <Label>Branch Type</Label>
                    <Select 
                      value={newBranch.branch_type} 
                      onValueChange={(value) => setNewBranch(prev => ({ ...prev, branch_type: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {branchTypeOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={newBranch.description}
                      onChange={(e) => setNewBranch(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button onClick={handleSaveBranch} disabled={savingBranch} size="sm">
                    {savingBranch ? "Saving..." : editingBranch ? "Update" : "Add Branch"}
                  </Button>
                  {editingBranch && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setEditingBranch(null);
                        setNewBranch({ prefix: "", branch_name: "", branch_type: "outlet", description: "" });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Existing Branches List */}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Branch Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branchCodes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                        No branches configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    branchCodes.map((branch) => (
                      <TableRow key={branch.id}>
                        <TableCell className="font-mono font-bold">{branch.prefix || "(empty)"}</TableCell>
                        <TableCell>{branch.branch_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {branch.branch_type?.replace("_", " ") || "outlet"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{branch.description || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditBranch(branch)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive"
                              onClick={() => handleDeleteBranch(branch.id)}
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
              <GitBranch className="h-5 w-5 text-primary" />
              Branch Trade Report
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Trade summaries for branch/outlet codes by prefix
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
            <p className="text-xs text-muted-foreground">Branches</p>
            <p className="text-xl font-bold">{totals.branches}</p>
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
          
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branchOptions.map((branch) => (
                <SelectItem key={branch.prefix} value={branch.prefix}>
                  {branch.name} ({branch.prefix || "Direct"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Branch Cards */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No branch trades found
          </div>
        ) : (
          <div className="space-y-4">
            {filteredData.map((branch) => (
              <Collapsible
                key={branch.prefix}
                open={expandedBranches.has(branch.prefix)}
                onOpenChange={() => toggleBranch(branch.prefix)}
              >
                <CollapsibleTrigger asChild>
                  <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {expandedBranches.has(branch.prefix) ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronRight className="h-5 w-5" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{branch.branch_name}</h3>
                              <Badge variant="outline" className="capitalize text-xs">
                                {branch.branch_type?.replace("_", " ") || "outlet"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Prefix: {branch.prefix || "(direct)"} • {branch.codes.length} codes • {branch.total_trades.toLocaleString()} trades
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-6 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">Buy</p>
                            <p className="font-mono text-green-600">{formatCurrency(branch.total_buy)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Sell</p>
                            <p className="font-mono text-red-600">{formatCurrency(branch.total_sell)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Net</p>
                            <p className={cn("font-mono font-bold", branch.total_net >= 0 ? "text-green-600" : "text-red-600")}>
                              {formatCurrency(branch.total_net)}
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
                        {branch.codes.map((code) => (
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
