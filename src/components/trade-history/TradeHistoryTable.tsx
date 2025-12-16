import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarIcon, Search, Filter, Loader2, ChevronLeft, ChevronRight, Settings2, Plus, Trash2, Calculator } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TradeRecord {
  id: string;
  action: string | null;
  status: string | null;
  side: string | null;
  security_code: string | null;
  client_code: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  trade_date: string | null;
  trade_time: string | null;
  file_name: string | null;
  uploaded_at: string;
  order_id: string | null;
  exec_id: string | null;
  isin: string | null;
  board: string | null;
  session: string | null;
  fill_type: string | null;
  category: string | null;
  boid: string | null;
  trader_dealer_id: string | null;
  owner_dealer_id: string | null;
  // Denormalized investor/client data (stored on trade record)
  brokerage_commission: number | null;
  interest_rate: number | null;
  account_type: string | null;
  investor_type: string | null;
  ledger_balance_snapshot: number | null;
  // Denormalized agent/RM data
  agent_id: string | null;
  rm_id: string | null;
  rm_name: string | null;
  department: string | null;
  // Denormalized deposit/withdrawal data
  total_deposits: number | null;
  total_withdrawals: number | null;
  net_deposit: number | null;
}

interface ColumnConfig {
  key: string;
  label: string;
  defaultVisible: boolean;
  type: 'string' | 'number' | 'currency' | 'date' | 'badge';
}

interface CustomColumn {
  id: string;
  name: string;
  formula: string;
}

const BASE_COLUMNS: ColumnConfig[] = [
  { key: "trade_date", label: "Date", defaultVisible: true, type: 'date' },
  { key: "trade_time", label: "Time", defaultVisible: false, type: 'string' },
  { key: "client_code", label: "Client Code", defaultVisible: true, type: 'string' },
  { key: "security_code", label: "Security", defaultVisible: true, type: 'string' },
  { key: "side", label: "Side", defaultVisible: true, type: 'badge' },
  { key: "quantity", label: "Quantity", defaultVisible: true, type: 'number' },
  { key: "price", label: "Price", defaultVisible: true, type: 'number' },
  { key: "value", label: "Value", defaultVisible: true, type: 'currency' },
  { key: "action", label: "Action", defaultVisible: true, type: 'badge' },
  { key: "status", label: "Status", defaultVisible: false, type: 'string' },
  { key: "order_id", label: "Order ID", defaultVisible: false, type: 'string' },
  { key: "exec_id", label: "Exec ID", defaultVisible: false, type: 'string' },
  { key: "isin", label: "ISIN", defaultVisible: false, type: 'string' },
  { key: "board", label: "Board", defaultVisible: false, type: 'string' },
  { key: "session", label: "Session", defaultVisible: false, type: 'string' },
  { key: "fill_type", label: "Fill Type", defaultVisible: false, type: 'string' },
  { key: "category", label: "Category", defaultVisible: false, type: 'string' },
  { key: "boid", label: "BOID", defaultVisible: false, type: 'string' },
  { key: "trader_dealer_id", label: "Trader ID", defaultVisible: false, type: 'string' },
  { key: "owner_dealer_id", label: "Owner ID", defaultVisible: false, type: 'string' },
  { key: "file_name", label: "File", defaultVisible: true, type: 'string' },
  // Denormalized investor/client fields
  { key: "brokerage_commission", label: "Brokerage Comm.", defaultVisible: false, type: 'number' },
  { key: "interest_rate", label: "Interest Rate", defaultVisible: false, type: 'number' },
  { key: "account_type", label: "Account Type", defaultVisible: false, type: 'string' },
  { key: "investor_type", label: "Investor Type", defaultVisible: false, type: 'string' },
  { key: "ledger_balance_snapshot", label: "Ledger Balance", defaultVisible: false, type: 'currency' },
  // Denormalized agent/RM fields
  { key: "agent_id", label: "Agent ID", defaultVisible: false, type: 'string' },
  { key: "rm_id", label: "RM ID", defaultVisible: false, type: 'string' },
  { key: "rm_name", label: "RM Name", defaultVisible: false, type: 'string' },
  { key: "department", label: "Department", defaultVisible: false, type: 'string' },
  // Denormalized deposit/withdrawal fields
  { key: "total_deposits", label: "Total Deposits", defaultVisible: false, type: 'currency' },
  { key: "total_withdrawals", label: "Total Withdrawals", defaultVisible: false, type: 'currency' },
  { key: "net_deposit", label: "Net Deposit", defaultVisible: false, type: 'currency' },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

// Safe formula evaluator
const evaluateFormula = (formula: string, trade: TradeRecord): string | number => {
  try {
    // Replace field references with actual values
    let expression = formula;
    
    // Available fields for formulas (denormalized investor data stored on trade)
    const fields: Record<string, number | string | null> = {
      quantity: trade.quantity,
      price: trade.price,
      value: trade.value,
      side: trade.side,
      brokerage_commission: trade.brokerage_commission,
      interest_rate: trade.interest_rate,
      account_type: trade.account_type,
      investor_type: trade.investor_type,
      ledger_balance: trade.ledger_balance_snapshot,
      total_deposits: trade.total_deposits,
      total_withdrawals: trade.total_withdrawals,
      net_deposit: trade.net_deposit,
    };

    // Replace field names with values
    Object.entries(fields).forEach(([key, val]) => {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      if (typeof val === 'number') {
        expression = expression.replace(regex, String(val || 0));
      } else if (typeof val === 'string') {
        expression = expression.replace(regex, `"${val}"`);
      } else {
        expression = expression.replace(regex, '0');
      }
    });

    // Support common functions
    expression = expression.replace(/ABS\(/gi, 'Math.abs(');
    expression = expression.replace(/ROUND\(/gi, 'Math.round(');
    expression = expression.replace(/FLOOR\(/gi, 'Math.floor(');
    expression = expression.replace(/CEIL\(/gi, 'Math.ceil(');
    expression = expression.replace(/MIN\(/gi, 'Math.min(');
    expression = expression.replace(/MAX\(/gi, 'Math.max(');
    expression = expression.replace(/POW\(/gi, 'Math.pow(');
    expression = expression.replace(/SQRT\(/gi, 'Math.sqrt(');

    // Support IF statements: IF(condition, trueVal, falseVal)
    expression = expression.replace(/IF\s*\(\s*(.+?)\s*,\s*(.+?)\s*,\s*(.+?)\s*\)/gi, '($1 ? $2 : $3)');

    // Validate - only allow safe characters
    if (!/^[\d\s\+\-\*\/\(\)\.\,\?\:\<\>\=\!\&\|\"Math\.absroundflooceimaxinpowsqrt]+$/i.test(expression)) {
      return 'Invalid';
    }

    // Evaluate
    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' ? (isNaN(result) ? 0 : result) : result;
  } catch (e) {
    return 'Error';
  }
};

export function TradeHistoryTable() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [hideZeroValues, setHideZeroValues] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Column customization
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    BASE_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)
  );

  // Custom formula columns
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>(() => {
    const saved = localStorage.getItem('tradeHistory_customColumns');
    return saved ? JSON.parse(saved) : [];
  });
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnFormula, setNewColumnFormula] = useState("");
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false);

  // Save custom columns to localStorage
  useEffect(() => {
    localStorage.setItem('tradeHistory_customColumns', JSON.stringify(customColumns));
  }, [customColumns]);

  useEffect(() => {
    fetchFileNames();
    fetchTotalCount();
  }, []);

  // Fetch trades with server-side filtering
  useEffect(() => {
    fetchTrades();
  }, [searchTerm, sideFilter, selectedFile, dateFrom, dateTo, currentPage, pageSize, hideZeroValues, statusFilter]);

  const fetchFileNames = async () => {
    try {
      // Use distinct file names from recent uploads only to avoid timeout
      const { data, error } = await supabase
        .from("trade_history")
        .select("file_name")
        .not("file_name", "is", null)
        .order("uploaded_at", { ascending: false })
        .limit(500);
      
      if (error) {
        console.error("Error fetching file names:", error);
        return;
      }
      
      if (data) {
        const unique = [...new Set(data.map(d => d.file_name).filter(Boolean))] as string[];
        setFileNames(unique);
      }
    } catch (error) {
      console.error("Error fetching file names:", error);
    }
  };

  const fetchTotalCount = async () => {
    // Skip count for initial load - will be set when fetching trades with filters
    setTotalCount(0);
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const hasFilters = searchTerm || sideFilter !== "all" || selectedFile !== "all" || 
                         dateFrom || dateTo || statusFilter !== "all";
      
      // First fetch trades
      let query = supabase
        .from("trade_history")
        .select("*", hasFilters ? { count: "exact" } : { count: "planned" });

      // Apply search filter (server-side)
      if (searchTerm) {
        query = query.or(`client_code.ilike.%${searchTerm}%,security_code.ilike.%${searchTerm}%`);
      }

      // Apply side filter
      if (sideFilter !== "all") {
        query = query.eq("side", sideFilter);
      }

      // Apply file filter
      if (selectedFile !== "all") {
        query = query.eq("file_name", selectedFile);
      }

      // Apply date filters
      if (dateFrom) {
        const fromStr = format(dateFrom, "yyyyMMdd");
        query = query.gte("trade_date", fromStr);
      }
      if (dateTo) {
        const toStr = format(dateTo, "yyyyMMdd");
        query = query.lte("trade_date", toStr);
      }

      // Apply zero-value filter
      if (hideZeroValues) {
        query = query.gt("value", 0);
      }

      // Apply status filter
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      // Apply pagination - fetch limited records
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      // Fetch trades - denormalized fields are already on trade_history
      const { data, error } = await query
        .order("uploaded_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      
      setTrades(data || []);
      // Estimate count based on returned data (count query is too slow on large tables)
      const estimatedCount = data?.length === pageSize 
        ? (currentPage * pageSize) + pageSize 
        : ((currentPage - 1) * pageSize) + (data?.length || 0);
      setFilteredCount(Math.max(filteredCount, estimatedCount));
    } catch (error) {
      console.error("Error fetching trades:", error);
      toast({
        title: "Error",
        description: "Failed to fetch trade history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const [filteredCount, setFilteredCount] = useState(0);
  const totalPages = Math.ceil(filteredCount / pageSize);

  const clearFilters = () => {
    setSearchInput("");
    setSearchTerm("");
    setSideFilter("all");
    setStatusFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setSelectedFile("all");
    setHideZeroValues(true);
    setCurrentPage(1);
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "-";
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatTradeDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const formatted = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      return format(new Date(formatted), "dd MMM yyyy");
    } catch {
      return dateStr;
    }
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const addCustomColumn = () => {
    if (!newColumnName.trim() || !newColumnFormula.trim()) {
      toast({ title: "Error", description: "Name and formula are required", variant: "destructive" });
      return;
    }
    
    const newCol: CustomColumn = {
      id: `custom_${Date.now()}`,
      name: newColumnName.trim(),
      formula: newColumnFormula.trim(),
    };
    
    setCustomColumns(prev => [...prev, newCol]);
    setNewColumnName("");
    setNewColumnFormula("");
    setFormulaDialogOpen(false);
    toast({ title: "Column added", description: `Custom column "${newCol.name}" created` });
  };

  const removeCustomColumn = (id: string) => {
    setCustomColumns(prev => prev.filter(c => c.id !== id));
  };

  const renderCellValue = (trade: TradeRecord, column: ColumnConfig) => {
    const value = trade[column.key as keyof TradeRecord];
    
    switch (column.type) {
      case 'date':
        return formatTradeDate(value as string | null);
      case 'currency':
        return formatCurrency(value as number | null);
      case 'number':
        return value !== null ? Number(value).toLocaleString() : "-";
      case 'badge':
        if (!value) return "-";
        const isSide = column.key === 'side';
        return (
          <Badge 
            variant={isSide && value === "BUY" ? "default" : isSide ? "destructive" : "outline"} 
            className="text-xs"
          >
            {String(value)}
          </Badge>
        );
      default:
        return value !== null ? String(value) : "-";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Trade History
          </CardTitle>
          <div className="flex gap-2">
            {/* Add Formula Column */}
            <Dialog open={formulaDialogOpen} onOpenChange={setFormulaDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Calculator className="h-4 w-4 mr-2" />
                  Add Formula
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Custom Formula Column</DialogTitle>
                  <DialogDescription>
                    Create a calculated column using formulas. Available fields: quantity, price, value, side, brokerage_commission, interest_rate, account_type, investor_type, ledger_balance, total_deposits, total_withdrawals
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Column Name</Label>
                    <Input
                      placeholder="e.g., Commission"
                      value={newColumnName}
                      onChange={(e) => setNewColumnName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Formula</Label>
                    <Textarea
                      placeholder="e.g., value * 0.0015"
                      value={newColumnFormula}
                      onChange={(e) => setNewColumnFormula(e.target.value)}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Examples: <br />
                      • Commission: <code>value * brokerage_commission / 100</code><br />
                      • Net Balance: <code>ledger_balance + total_deposits - total_withdrawals</code><br />
                      • Adjusted Value: <code>IF(account_type == "Margin", value * 1.5, value)</code><br />
                      • Functions: ABS(), ROUND(), MIN(), MAX(), SQRT()
                    </p>
                  </div>
                  
                  {customColumns.length > 0 && (
                    <div className="space-y-2">
                      <Label>Existing Custom Columns</Label>
                      <div className="space-y-1">
                        {customColumns.map(col => (
                          <div key={col.id} className="flex items-center justify-between text-sm bg-secondary/50 rounded px-2 py-1">
                            <span>{col.name}: <code className="text-xs">{col.formula}</code></span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCustomColumn(col.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setFormulaDialogOpen(false)}>Cancel</Button>
                  <Button onClick={addCustomColumn}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Column
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Column Settings */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-80 overflow-y-auto" align="end">
                <div className="space-y-2">
                  <p className="text-sm font-medium mb-3">Visible Columns</p>
                  {BASE_COLUMNS.map(column => (
                    <div key={column.key} className="flex items-center gap-2">
                      <Checkbox
                        id={column.key}
                        checked={visibleColumns.includes(column.key)}
                        onCheckedChange={() => toggleColumn(column.key)}
                      />
                      <label htmlFor={column.key} className="text-sm cursor-pointer">
                        {column.label}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search client/security code..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={sideFilter} onValueChange={(v) => { setSideFilter(v); setCurrentPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Side" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="BUY">Buy</SelectItem>
              <SelectItem value="SELL">Sell</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="FILLED">Filled</SelectItem>
              <SelectItem value="PARTIAL">Partial</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedFile} onValueChange={(v) => { setSelectedFile(v); setCurrentPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="File" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Files</SelectItem>
              {fileNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "dd MMM yyyy") : "From date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => { setDateFrom(d); setCurrentPage(1); }} className="pointer-events-auto" />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "dd MMM yyyy") : "To date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => { setDateTo(d); setCurrentPage(1); }} className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>

        {/* Additional Filters Row */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Checkbox 
              id="hideZeroValues" 
              checked={hideZeroValues} 
              onCheckedChange={(checked) => { setHideZeroValues(checked === true); setCurrentPage(1); }}
            />
            <label htmlFor="hideZeroValues" className="text-sm cursor-pointer">
              Hide zero-value trades (expired/cancelled)
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear Filters
          </Button>
          <span className="text-sm text-muted-foreground">
            Showing {trades.length} of {filteredCount} filtered trades (Total: {totalCount.toLocaleString()})
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {BASE_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                    <TableHead key={column.key} className={column.type === 'number' || column.type === 'currency' ? 'text-right' : ''}>
                      {column.label}
                    </TableHead>
                  ))}
                  {customColumns.map(col => (
                    <TableHead key={col.id} className="text-right bg-primary/5">
                      <div className="flex items-center gap-1 justify-end">
                        <Calculator className="h-3 w-3" />
                        {col.name}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length + customColumns.length} className="text-center py-8 text-muted-foreground">
                      No trades found
                    </TableCell>
                  </TableRow>
                ) : (
                  trades.map((trade) => (
                    <TableRow key={trade.id}>
                      {BASE_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                        <TableCell 
                          key={column.key} 
                          className={cn(
                            "whitespace-nowrap",
                            (column.type === 'number' || column.type === 'currency') && 'text-right',
                            column.key === 'file_name' && 'max-w-[150px] truncate text-xs text-muted-foreground'
                          )}
                        >
                          {renderCellValue(trade, column)}
                        </TableCell>
                      ))}
                      {customColumns.map(col => {
                        const result = evaluateFormula(col.formula, trade);
                        return (
                          <TableCell key={col.id} className="text-right bg-primary/5 font-mono text-sm">
                            {typeof result === 'number' ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : result}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {!loading && filteredCount > 0 && (
          <div className="flex items-center justify-between pt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages || 1}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
