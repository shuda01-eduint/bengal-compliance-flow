import { useState, useEffect, useMemo } from "react";
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
import { CalendarIcon, Search, Filter, Loader2, ChevronLeft, ChevronRight, Settings2, Plus, Trash2, Calculator, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTradesPaginated, useAvailableFileNames } from "@/hooks/useTradesPaginated";
import { useDebounce } from "@/hooks/useDebounce";
import type { TradeHistory } from "@/services/types";

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
  { key: "brokerage_commission", label: "Brokerage Comm.", defaultVisible: false, type: 'number' },
  { key: "interest_rate", label: "Interest Rate", defaultVisible: false, type: 'number' },
  { key: "account_type", label: "Account Type", defaultVisible: false, type: 'string' },
  { key: "investor_type", label: "Investor Type", defaultVisible: false, type: 'string' },
  { key: "ledger_balance_snapshot", label: "Ledger Balance", defaultVisible: true, type: 'currency' },
  { key: "agent_id", label: "Agent ID", defaultVisible: false, type: 'string' },
  { key: "rm_id", label: "RM ID", defaultVisible: false, type: 'string' },
  { key: "rm_name", label: "RM Name", defaultVisible: true, type: 'string' },
  { key: "department", label: "Department", defaultVisible: false, type: 'string' },
  { key: "total_deposits", label: "Total Deposits", defaultVisible: false, type: 'currency' },
  { key: "total_withdrawals", label: "Total Withdrawals", defaultVisible: false, type: 'currency' },
  { key: "net_deposit", label: "Net Deposit", defaultVisible: false, type: 'currency' },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

// Safe formula evaluator
const evaluateFormula = (formula: string, trade: TradeHistory): string | number => {
  try {
    let expression = formula;
    
    const buyValue = trade.side === "BUY" ? (trade.value || 0) : 0;
    const sellValue = trade.side === "SELL" ? (trade.value || 0) : 0;
    const netBuy = buyValue - sellValue;
    const netSell = sellValue - buyValue;
    const adjustedBalance = (trade.ledger_balance_snapshot || 0) + (trade.total_deposits || 0) - (trade.total_withdrawals || 0);
    const dynamicLedger = (trade.ledger_balance_snapshot || 0) + (trade.total_deposits || 0) - (trade.total_withdrawals || 0) + netSell;
    
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
      buy_value: buyValue,
      sell_value: sellValue,
      net_buy: netBuy,
      net_sell: netSell,
      adjusted_balance: adjustedBalance,
      dynamic_ledger: dynamicLedger,
    };

    const sortedKeys = Object.keys(fields).sort((a, b) => b.length - a.length);
    sortedKeys.forEach((key) => {
      const val = fields[key];
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      if (typeof val === 'number') {
        expression = expression.replace(regex, String(val || 0));
      } else if (typeof val === 'string') {
        expression = expression.replace(regex, `"${val}"`);
      } else {
        expression = expression.replace(regex, '0');
      }
    });

    expression = expression.replace(/ABS\(/gi, 'Math.abs(');
    expression = expression.replace(/ROUND\(/gi, 'Math.round(');
    expression = expression.replace(/FLOOR\(/gi, 'Math.floor(');
    expression = expression.replace(/CEIL\(/gi, 'Math.ceil(');
    expression = expression.replace(/MIN\(/gi, 'Math.min(');
    expression = expression.replace(/MAX\(/gi, 'Math.max(');
    expression = expression.replace(/POW\(/gi, 'Math.pow(');
    expression = expression.replace(/SQRT\(/gi, 'Math.sqrt(');

    let maxIterations = 10;
    while (expression.includes('IF(') && maxIterations > 0) {
      expression = expression.replace(/IF\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, '($1 ? $2 : $3)');
      maxIterations--;
    }

    if (!/^[\d\s\+\-\*\/\(\)\.\,\?\:\<\>\=\!\&\|\"\w]+$/i.test(expression)) {
      return 'Invalid';
    }

    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' ? (isNaN(result) ? 0 : result) : result;
  } catch (e) {
    console.error('Formula error:', e, formula);
    return 'Error';
  }
};

export function TradeHistoryTable() {
  const [searchInput, setSearchInput] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [selectedFile, setSelectedFile] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hideZeroValues, setHideZeroValues] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<string>("trade_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const { toast } = useToast();

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 500);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, sideFilter, selectedFile, dateFrom, dateTo, hideZeroValues, statusFilter]);

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

  // Fetch file names using the new hook
  const { data: fileNames = [] } = useAvailableFileNames();

  // Build filters for the query
  const filters = useMemo(() => ({
    dateFrom: dateFrom ? format(dateFrom, "yyyyMMdd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyyMMdd") : undefined,
    clientCode: debouncedSearch || undefined,
    side: sideFilter !== "all" ? sideFilter : undefined,
    fileName: selectedFile !== "all" ? selectedFile : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    hideZeroValues,
  }), [dateFrom, dateTo, debouncedSearch, sideFilter, selectedFile, statusFilter, hideZeroValues]);

  // Use the new paginated hook
  const { data: tradesData, isLoading, error } = useTradesPaginated({
    filters,
    pagination: { page: currentPage, pageSize },
    sort: { column: sortColumn, ascending: sortDirection === "asc" },
  });

  const trades = tradesData?.data || [];
  const totalCount = tradesData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  // Show error toast
  useEffect(() => {
    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch trade history",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  const clearFilters = () => {
    setSearchInput("");
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
    setCurrentPage(Math.max(1, Math.min(page, totalPages || 1)));
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
    setCurrentPage(1);
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

  const renderCellValue = (trade: TradeHistory, column: ColumnConfig) => {
    const value = trade[column.key as keyof TradeHistory];
    
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
            {totalCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {totalCount.toLocaleString()} records
              </Badge>
            )}
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
                  <DialogDescription className="space-y-2">
                    <p>Create a calculated column using formulas.</p>
                    <p className="text-xs"><strong>Fields:</strong> quantity, price, value, side, ledger_balance, total_deposits, total_withdrawals, net_deposit, brokerage_commission, interest_rate</p>
                    <p className="text-xs"><strong>Computed:</strong> buy_value, sell_value, net_buy, adjusted_balance, dynamic_ledger</p>
                    <p className="text-xs"><strong>Functions:</strong> IF(cond, true, false), ABS(), ROUND(), MIN(), MAX()</p>
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
                  </div>

                  {/* Formula Preview */}
                  {newColumnFormula.trim() && trades.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        Preview <span className="text-xs text-muted-foreground">(first 5 rows)</span>
                      </Label>
                      <div className="bg-secondary/50 rounded p-2 text-xs space-y-1 max-h-40 overflow-auto">
                        <div className="grid grid-cols-3 gap-2 font-medium border-b pb-1 mb-1">
                          <span>Client</span>
                          <span>Side</span>
                          <span>Result</span>
                        </div>
                        {trades.slice(0, 5).map((trade, idx) => {
                          const result = evaluateFormula(newColumnFormula, trade);
                          const isError = result === 'Error' || result === 'Invalid';
                          return (
                            <div key={idx} className="grid grid-cols-3 gap-2">
                              <span className="truncate">{trade.client_code || '-'}</span>
                              <span>{trade.side || '-'}</span>
                              <span className={cn(isError && "text-destructive font-medium")}>
                                {typeof result === 'number' ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : result}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
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

          <Select value={sideFilter} onValueChange={setSideFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Side" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="BUY">Buy</SelectItem>
              <SelectItem value="SELL">Sell</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
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

          <Select value={selectedFile} onValueChange={setSelectedFile}>
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

          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateFrom ? format(dateFrom, "dd MMM") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateTo ? format(dateTo, "dd MMM") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Filter controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="hideZero"
                checked={hideZeroValues}
                onCheckedChange={(checked) => setHideZeroValues(checked === true)}
              />
              <label htmlFor="hideZero" className="text-sm">Hide zero-value trades</label>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>

          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border rounded-md overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {BASE_COLUMNS.filter(c => visibleColumns.includes(c.key)).map((column) => (
                  <TableHead 
                    key={column.key}
                    className="cursor-pointer hover:bg-secondary/50 whitespace-nowrap"
                    onClick={() => handleSort(column.key)}
                  >
                    <div className="flex items-center gap-1">
                      {column.label}
                      {sortColumn === column.key ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </div>
                  </TableHead>
                ))}
                {customColumns.map((col) => (
                  <TableHead key={col.id} className="whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {col.name}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-4 w-4 opacity-50 hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); removeCustomColumn(col.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + customColumns.length} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + customColumns.length} className="text-center py-8 text-muted-foreground">
                    No trades found
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={trade.id}>
                    {BASE_COLUMNS.filter(c => visibleColumns.includes(c.key)).map((column) => (
                      <TableCell key={column.key} className="whitespace-nowrap">
                        {renderCellValue(trade, column)}
                      </TableCell>
                    ))}
                    {customColumns.map((col) => {
                      const result = evaluateFormula(col.formula, trade);
                      const isError = result === 'Error' || result === 'Invalid';
                      return (
                        <TableCell key={col.id} className={cn("whitespace-nowrap", isError && "text-destructive")}>
                          {typeof result === 'number' ? formatCurrency(result) : result}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalCount)} of {totalCount.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
