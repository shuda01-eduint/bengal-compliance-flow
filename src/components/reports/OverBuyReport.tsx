import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Download, AlertTriangle, CheckCircle, RefreshCw, Plus, Settings2, Trash2, Eye, EyeOff } from "lucide-react";
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
  net_position: number;
  violation_amount: number;
  is_violation: boolean;
}

interface CustomField {
  id: string;
  name: string;
  formula: string;
  type: "number" | "boolean" | "text";
}

interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  isCustom?: boolean;
}

const STORAGE_KEY = "overbuy_report_preferences";

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "inv_code", label: "Code", visible: true },
  { key: "investor_name", label: "Investor Name", visible: true },
  { key: "rm_name", label: "RM", visible: true },
  { key: "ledger_balance", label: "Ledger Balance", visible: true },
  { key: "total_deposits", label: "Deposits", visible: true },
  { key: "total_withdrawals", label: "Withdrawals", visible: true },
  { key: "adjusted_balance", label: "Adjusted Balance", visible: true },
  { key: "net_buy", label: "Net Buy", visible: true },
  { key: "net_sell", label: "Net Sell", visible: true },
  { key: "net_position", label: "Net Position", visible: true },
  { key: "violation_amount", label: "Violation", visible: true },
  { key: "is_violation", label: "Status", visible: true },
];

// Safe formula evaluator
const evaluateFormula = (formula: string, data: ClientOverBuyData): string | number | boolean => {
  try {
    const variables: Record<string, number | boolean> = {
      code: 0,
      ledger_balance: data.ledger_balance,
      deposits: data.total_deposits,
      withdrawals: data.total_withdrawals,
      adjusted_balance: data.adjusted_balance,
      net_buy: data.net_buy,
      net_sell: data.net_sell,
      net_position: data.net_position,
      violation_amount: data.violation_amount,
      is_violation: data.is_violation ? 1 : 0,
    };

    let result = formula;
    
    // Handle IF statements: IF(condition, trueValue, falseValue)
    const ifRegex = /IF\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi;
    result = result.replace(ifRegex, (_, condition, trueVal, falseVal) => {
      let evalCondition = condition;
      Object.entries(variables).forEach(([key, val]) => {
        evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
      });
      try {
        const condResult = Function(`"use strict"; return (${evalCondition})`)();
        return condResult ? trueVal.trim() : falseVal.trim();
      } catch {
        return "ERROR";
      }
    });

    // Replace variable names with values
    Object.entries(variables).forEach(([key, val]) => {
      result = result.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
    });

    // Support basic math functions
    result = result.replace(/ABS\s*\(/gi, "Math.abs(");
    result = result.replace(/MAX\s*\(/gi, "Math.max(");
    result = result.replace(/MIN\s*\(/gi, "Math.min(");
    result = result.replace(/ROUND\s*\(/gi, "Math.round(");

    // Evaluate the expression
    const evaluated = Function(`"use strict"; return (${result})`)();
    return evaluated;
  } catch (error) {
    console.error("Formula evaluation error:", error);
    return "ERROR";
  }
};

export function OverBuyReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ClientOverBuyData[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRm, setSelectedRm] = useState<string>("all");
  const [showViolationsOnly, setShowViolationsOnly] = useState(false);
  
  // Custom fields and column visibility
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.columns || DEFAULT_COLUMNS;
    }
    return DEFAULT_COLUMNS;
  });
  
  const [customFields, setCustomFields] = useState<CustomField[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.customFields || [];
    }
    return [];
  });

  const [newFieldDialog, setNewFieldDialog] = useState(false);
  const [newField, setNewField] = useState<Partial<CustomField>>({
    name: "",
    formula: "",
    type: "number",
  });

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, customFields }));
  }, [columns, customFields]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("inv_code, investor_name, rm_name, rm_email, ledger_balance");

      if (clientsError) throw clientsError;

      const { data: transactions, error: txError } = await supabase
        .from("deposits_withdrawals")
        .select("investor_code, transaction_type, amount");

      if (txError) throw txError;

      const { data: trades, error: tradesError } = await supabase
        .from("trade_history")
        .select("client_code, side, value");

      if (tradesError) throw tradesError;

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

  const rmOptions = useMemo(() => {
    const unique = [...new Set(data.map((d) => d.rm_name).filter(Boolean))];
    return unique.sort();
  }, [data]);

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

  const toggleColumnVisibility = (key: string) => {
    setColumns(prev => prev.map(col => 
      col.key === key ? { ...col, visible: !col.visible } : col
    ));
  };

  const addCustomField = () => {
    if (!newField.name || !newField.formula) {
      toast.error("Please provide a name and formula");
      return;
    }

    const fieldId = `custom_${Date.now()}`;
    const field: CustomField = {
      id: fieldId,
      name: newField.name,
      formula: newField.formula,
      type: newField.type as "number" | "boolean" | "text",
    };

    setCustomFields(prev => [...prev, field]);
    setColumns(prev => [...prev, { key: fieldId, label: newField.name, visible: true, isCustom: true }]);
    setNewField({ name: "", formula: "", type: "number" });
    setNewFieldDialog(false);
    toast.success("Custom field added");
  };

  const removeCustomField = (fieldId: string) => {
    setCustomFields(prev => prev.filter(f => f.id !== fieldId));
    setColumns(prev => prev.filter(col => col.key !== fieldId));
    toast.success("Custom field removed");
  };

  const handleExport = () => {
    const visibleCols = columns.filter(c => c.visible);
    const exportData = filteredData.map((d) => {
      const row: Record<string, unknown> = {};
      visibleCols.forEach(col => {
        if (col.isCustom) {
          const field = customFields.find(f => f.id === col.key);
          if (field) {
            row[col.label] = evaluateFormula(field.formula, d);
          }
        } else {
          switch (col.key) {
            case "inv_code": row[col.label] = d.inv_code; break;
            case "investor_name": row[col.label] = d.investor_name; break;
            case "rm_name": row[col.label] = d.rm_name; break;
            case "ledger_balance": row[col.label] = d.ledger_balance; break;
            case "total_deposits": row[col.label] = d.total_deposits; break;
            case "total_withdrawals": row[col.label] = d.total_withdrawals; break;
            case "adjusted_balance": row[col.label] = d.adjusted_balance; break;
            case "net_buy": row[col.label] = d.net_buy; break;
            case "net_sell": row[col.label] = d.net_sell; break;
            case "net_position": row[col.label] = d.net_position; break;
            case "violation_amount": row[col.label] = d.violation_amount; break;
            case "is_violation": row[col.label] = d.is_violation ? "VIOLATION" : "OK"; break;
          }
        }
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OverBuy Report");
    XLSX.writeFile(wb, `overbuy_report_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Report exported successfully");
  };

  const renderCellValue = (row: ClientOverBuyData, col: ColumnConfig) => {
    if (col.isCustom) {
      const field = customFields.find(f => f.id === col.key);
      if (field) {
        const value = evaluateFormula(field.formula, row);
        if (field.type === "boolean") {
          return value ? (
            <Badge variant="default" className="bg-green-600">Yes</Badge>
          ) : (
            <Badge variant="outline">No</Badge>
          );
        }
        if (field.type === "number" && typeof value === "number") {
          return formatCurrency(value);
        }
        return String(value);
      }
      return "-";
    }

    switch (col.key) {
      case "inv_code":
        return <span className="font-mono text-sm">{row.inv_code}</span>;
      case "investor_name":
        return row.investor_name;
      case "rm_name":
        return row.rm_name;
      case "ledger_balance":
        return <span className="font-mono">{formatCurrency(row.ledger_balance)}</span>;
      case "total_deposits":
        return <span className="font-mono text-green-600">{formatCurrency(row.total_deposits)}</span>;
      case "total_withdrawals":
        return <span className="font-mono text-red-600">{formatCurrency(row.total_withdrawals)}</span>;
      case "adjusted_balance":
        return <span className="font-mono font-medium">{formatCurrency(row.adjusted_balance)}</span>;
      case "net_buy":
        return <span className="font-mono">{formatCurrency(row.net_buy)}</span>;
      case "net_sell":
        return <span className="font-mono">{formatCurrency(row.net_sell)}</span>;
      case "net_position":
        return <span className="font-mono font-medium">{formatCurrency(row.net_position)}</span>;
      case "violation_amount":
        return <span className="font-mono text-destructive font-bold">{row.is_violation ? formatCurrency(row.violation_amount) : "-"}</span>;
      case "is_violation":
        return row.is_violation ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Violation
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3" />
            OK
          </Badge>
        );
      default:
        return "-";
    }
  };

  const visibleColumns = columns.filter(c => c.visible);

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
          {/* Column Settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-2" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="end">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Toggle Columns</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {columns.map((col) => (
                    <div key={col.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={col.key}
                          checked={col.visible}
                          onCheckedChange={() => toggleColumnVisibility(col.key)}
                        />
                        <Label htmlFor={col.key} className="text-sm cursor-pointer">
                          {col.label}
                        </Label>
                      </div>
                      {col.isCustom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => removeCustomField(col.key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Add Custom Field */}
          <Dialog open={newFieldDialog} onOpenChange={setNewFieldDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Field
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Custom Field</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Field Name</Label>
                  <Input
                    value={newField.name}
                    onChange={(e) => setNewField(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Risk Score"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Formula</Label>
                  <Input
                    value={newField.formula}
                    onChange={(e) => setNewField(prev => ({ ...prev, formula: e.target.value }))}
                    placeholder="e.g., net_position / adjusted_balance * 100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Available variables: ledger_balance, deposits, withdrawals, adjusted_balance, net_buy, net_sell, net_position, violation_amount, is_violation
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Functions: IF(condition, true, false), ABS(), MAX(), MIN(), ROUND()
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Output Type</Label>
                  <Select
                    value={newField.type}
                    onValueChange={(v) => setNewField(prev => ({ ...prev, type: v as "number" | "boolean" | "text" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="number">Number (Currency)</SelectItem>
                      <SelectItem value="boolean">Yes/No</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewFieldDialog(false)}>Cancel</Button>
                <Button onClick={addCustomField}>Add Field</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
                {visibleColumns.map((col) => (
                  <TableHead 
                    key={col.key}
                    className={["ledger_balance", "total_deposits", "total_withdrawals", "adjusted_balance", "net_buy", "net_sell", "net_position", "violation_amount"].includes(col.key) || col.isCustom ? "text-right" : col.key === "is_violation" ? "text-center" : ""}
                  >
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {visibleColumns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length} className="text-center py-8 text-muted-foreground">
                    No data found
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.slice(0, 100).map((row) => (
                  <TableRow
                    key={row.inv_code}
                    className={row.is_violation ? "bg-destructive/5" : ""}
                  >
                    {visibleColumns.map((col) => (
                      <TableCell 
                        key={col.key}
                        className={["ledger_balance", "total_deposits", "total_withdrawals", "adjusted_balance", "net_buy", "net_sell", "net_position", "violation_amount"].includes(col.key) || col.isCustom ? "text-right" : col.key === "is_violation" ? "text-center" : ""}
                      >
                        {renderCellValue(row, col)}
                      </TableCell>
                    ))}
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
