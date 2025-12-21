import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import { Search, Download, Wallet, TrendingUp, TrendingDown, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText, ArrowDownToLine, ArrowUpFromLine, Eye, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Calculator } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/balance-utils";
import { toast } from "sonner";
import { AccountingReconciliationDialog } from "./AccountingReconciliationDialog";
import { TradeDetailsDialog } from "./TradeDetailsDialog";
import { useDebounce } from "@/hooks/useDebounce";

export interface AccountingRow {
  investor_code: string;
  investor_name: string;
  account_type: string;
  interest_rate: number;
  brokerage_commission: number;
  ledger_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  net_buy: number;
  net_sell: number;
  adjusted_ledger: number;
  accrued_interest: number;
  receivable: number;
  payable: number;
  brokerage_amount: number;
  final_balance: number;
  gross_buy: number;
  gross_sell: number;
  [key: string]: string | number;
}

interface CustomField {
  id: string;
  name: string;
  formula: string;
}

interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  align?: 'left' | 'right';
  colorClass?: string;
}

const STORAGE_KEY = 'accounting-custom-fields';
const COLUMNS_STORAGE_KEY = 'accounting-columns-config-v2';
const PAGE_SIZE = 50;

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'investor_code', label: 'Code', visible: true, align: 'left' },
  { id: 'investor_name', label: 'Name', visible: true, align: 'left' },
  { id: 'account_type', label: 'Type', visible: true, align: 'left' },
  { id: 'interest_rate', label: 'Int %', visible: true, align: 'right' },
  { id: 'brokerage_commission', label: 'Comm %', visible: false, align: 'right' },
  { id: 'ledger_balance', label: 'Ledger Bal', visible: true, align: 'right' },
  { id: 'total_deposits', label: 'Deposits', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'total_withdrawals', label: 'Withdrawals', visible: true, align: 'right', colorClass: 'text-amber-400' },
  { id: 'gross_buy', label: 'Gross Buy', visible: true, align: 'right', colorClass: 'text-red-400' },
  { id: 'net_buy', label: 'Net Buy', visible: true, align: 'right', colorClass: 'text-red-400' },
  { id: 'gross_sell', label: 'Gross Sell', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'net_sell', label: 'Net Sell', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'adjusted_ledger', label: 'Adj. Ledger', visible: false, align: 'right' },
  { id: 'accrued_interest', label: 'Accrued Int.', visible: true, align: 'right', colorClass: 'text-orange-400' },
  { id: 'payable', label: 'Payable', visible: false, align: 'right', colorClass: 'text-red-400' },
  { id: 'brokerage_amount', label: 'Brokerage', visible: true, align: 'right' },
  { id: 'final_balance', label: 'Closing Balance', visible: true, align: 'right', colorClass: 'text-blue-400' },
  { id: 'receivable', label: 'Net Receivable (after interest)', visible: false, align: 'right' },
];

const evaluateFormula = (formula: string, row: AccountingRow): number => {
  try {
    let expression = formula.toLowerCase();
    
    const fieldMap: Record<string, number> = {
      'ledger_balance': row.ledger_balance,
      'ledger': row.ledger_balance,
      'deposits': row.total_deposits,
      'total_deposits': row.total_deposits,
      'withdrawals': row.total_withdrawals,
      'total_withdrawals': row.total_withdrawals,
      'net_buy': row.net_buy,
      'net_sell': row.net_sell,
      'adjusted_ledger': row.adjusted_ledger,
      'adjusted': row.adjusted_ledger,
      'accrued_interest': row.accrued_interest,
      'interest': row.accrued_interest,
      'receivable': row.receivable,
      'payable': row.payable,
      'interest_rate': row.interest_rate,
      'rate': row.interest_rate,
      'brokerage_commission': row.brokerage_commission,
      'brokerage_amount': row.brokerage_amount,
      'final_balance': row.final_balance,
      'commission': row.brokerage_commission,
      'gross_buy': row.gross_buy,
      'gross_sell': row.gross_sell,
    };

    Object.entries(fieldMap).forEach(([key, value]) => {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      expression = expression.replace(regex, String(value || 0));
    });

    // Handle MAX function
    expression = expression.replace(/max\(([^,]+),\s*([^)]+)\)/gi, (_, a, b) => {
      return `Math.max(${a}, ${b})`;
    });

    // Handle MIN function
    expression = expression.replace(/min\(([^,]+),\s*([^)]+)\)/gi, (_, a, b) => {
      return `Math.min(${a}, ${b})`;
    });

    // Handle ABS function
    expression = expression.replace(/abs\(([^)]+)\)/gi, (_, inner) => {
      return `Math.abs(${inner})`;
    });

    // Safe eval
    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' && !isNaN(result) ? result : 0;
  } catch {
    return 0;
  }
};

type ChartView = 'turnover' | 'margin' | 'commission';

const AccountingTab = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldFormula, setNewFieldFormula] = useState("");
  const [chartView, setChartView] = useState<ChartView>('turnover');
  const [selectedInvestor, setSelectedInvestor] = useState<AccountingRow | null>(null);
  const [fromDate, setFromDate] = useState<Date>(subDays(new Date(), 2));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [selectedTradeType, setSelectedTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [selectedTradeInvestor, setSelectedTradeInvestor] = useState<AccountingRow | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [hasTradesFilter, setHasTradesFilter] = useState<string>("all");
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .single();
      setIsAdmin(!!roleData);
    };
    checkAdmin();
  }, []);

  // Debounce search term for server-side search
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Reset to first page when search or filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedSearch, accountTypeFilter, hasTradesFilter]);

  // Load custom fields from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setCustomFields(JSON.parse(saved));
      } catch {
        console.error('Failed to load custom fields');
      }
    }
  }, []);

  // Load columns config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as ColumnConfig[];

      // Merge saved config with new defaults so newly-added columns (e.g. Closing Balance)
      // always appear without wiping the user's saved visibility/order.
      const defaultsById = new Map(DEFAULT_COLUMNS.map((c) => [c.id, c] as const));
      const seen = new Set<string>();
      const merged: ColumnConfig[] = [];

      parsed.forEach((c) => {
        const def = defaultsById.get(c.id);
        if (!def || seen.has(c.id)) return;
        merged.push({ ...def, visible: typeof c.visible === "boolean" ? c.visible : def.visible });
        seen.add(c.id);
      });

      DEFAULT_COLUMNS.forEach((def) => {
        if (!seen.has(def.id)) merged.push(def);
      });

      setColumns(merged);
    } catch {
      console.error('Failed to load columns config');
    }
  }, []);

  // Save custom fields to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customFields));
  }, [customFields]);

  // Save columns config to localStorage
  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  // Format dates for queries
  const fromDateStr = format(fromDate, 'yyyy-MM-dd');
  const toDateStr = format(toDate, 'yyyy-MM-dd');
  const fromTradeDateStr = format(fromDate, 'yyyyMMdd');
  const toTradeDateStr = format(toDate, 'yyyyMMdd');

  // Fetch accounting data using RPC function (server-side search + pagination + filters)
  const { data: accountingResult, isLoading: loadingData } = useQuery({
    queryKey: ['accounting-data', debouncedSearch, fromTradeDateStr, toTradeDateStr, fromDateStr, toDateStr, currentPage, accountTypeFilter, hasTradesFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_accounting_data', {
        _search_term: debouncedSearch || null,
        _from_trade_date: fromTradeDateStr,
        _to_trade_date: toTradeDateStr,
        _from_tx_date: fromDateStr,
        _to_tx_date: toDateStr,
        _page_size: PAGE_SIZE,
        _page_offset: currentPage * PAGE_SIZE,
        _account_type_filter: accountTypeFilter,
        _has_trades_filter: hasTradesFilter,
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch summary data using RPC function (with filters for accurate totals)
  const { data: summaryResult, isLoading: loadingSummary } = useQuery({
    queryKey: ['accounting-summary', fromTradeDateStr, toTradeDateStr, fromDateStr, toDateStr, accountTypeFilter, hasTradesFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_accounting_summary', {
        _from_trade_date: fromTradeDateStr,
        _to_trade_date: toTradeDateStr,
        _from_tx_date: fromDateStr,
        _to_tx_date: toDateStr,
        _account_type_filter: accountTypeFilter,
        _has_trades_filter: hasTradesFilter,
      });
      if (error) throw error;
      return data?.[0] || null;
    },
  });

  // Fetch turnover by department
  const { data: departmentTurnover } = useQuery({
    queryKey: ['accounting-turnover-by-department', fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_accounting_turnover_by_department', {
        _from_tx_date: fromDateStr,
        _to_tx_date: toDateStr,
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch balance comparison by department (period beginning vs ending)
  const { data: balanceComparison } = useQuery({
    queryKey: ['accounting-balance-comparison', fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_composition_by_department', {
        p_from_date: fromDateStr,
        p_to_date: toDateStr,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: chartView === 'margin',
  });

  // Fetch commission by department
  const { data: commissionByDept } = useQuery({
    queryKey: ['accounting-commission-by-department', fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_commission_by_department', {
        _from_tx_date: fromDateStr,
        _to_tx_date: toDateStr,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: chartView === 'commission',
  });

  // Process accounting data with custom fields (filtering now done server-side)
  const accountingData = useMemo(() => {
    if (!accountingResult) return [];
    
    return accountingResult.map((row: any) => {
      const processedRow: AccountingRow = {
        investor_code: row.investor_code || '',
        investor_name: row.investor_name || '',
        account_type: row.account_type || '',
        interest_rate: Number(row.interest_rate) || 0,
        brokerage_commission: Number(row.brokerage_commission) || 0,
        ledger_balance: Number(row.ledger_balance) || 0,
        total_deposits: Number(row.total_deposits) || 0,
        total_withdrawals: Number(row.total_withdrawals) || 0,
        gross_buy: Number(row.gross_buy) || 0,
        gross_sell: Number(row.gross_sell) || 0,
        net_buy: Number(row.net_buy) || 0,
        net_sell: Number(row.net_sell) || 0,
        adjusted_ledger: Number(row.adjusted_ledger) || 0,
        accrued_interest: Number(row.accrued_interest) || 0,
        brokerage_amount: Number(row.brokerage_amount) || 0,
        final_balance: Number(row.final_balance) || 0,
        receivable: Number(row.receivable) || 0,
        payable: Number(row.payable) || 0,
      };

      // Calculate custom fields
      customFields.forEach(field => {
        processedRow[field.id] = evaluateFormula(field.formula, processedRow);
      });

      return processedRow;
    });
  }, [accountingResult, customFields]);

  // Get total count from first row (all rows have the same total_count)
  const totalCount = accountingResult?.[0]?.total_count || 0;
  const totalPages = Math.ceil(Number(totalCount) / PAGE_SIZE);

  // Summary data
  const summary = useMemo(() => {
    if (!summaryResult) {
      return {
        totalAccounts: 0,
        marginAccounts: 0,
        totalMarginLoan: 0,
        totalAccruedInterest: 0,
        totalReceivable: 0,
        totalPayable: 0,
        totalBuy: 0,
        totalSell: 0,
        totalTradeValue: 0,
      };
    }
    return {
      totalAccounts: Number(summaryResult.total_accounts) || 0,
      marginAccounts: Number(summaryResult.margin_accounts) || 0,
      totalMarginLoan: Number(summaryResult.total_margin_loan) || 0,
      totalAccruedInterest: Number(summaryResult.total_accrued_interest) || 0,
      totalReceivable: Number(summaryResult.total_receivable) || 0,
      totalPayable: Number(summaryResult.total_payable) || 0,
      totalBuy: Number(summaryResult.total_buy) || 0,
      totalSell: Number(summaryResult.total_sell) || 0,
      totalTradeValue: Number(summaryResult.total_trade_value) || 0,
    };
  }, [summaryResult]);

  const isLoading = loadingData || loadingSummary;

  const handleAddField = () => {
    if (!newFieldName.trim() || !newFieldFormula.trim()) {
      toast.error('Please enter both field name and formula');
      return;
    }

    const field: CustomField = {
      id: `custom_${Date.now()}`,
      name: newFieldName.trim(),
      formula: newFieldFormula.trim(),
    };

    setCustomFields([...customFields, field]);
    setNewFieldName("");
    setNewFieldFormula("");
    toast.success(`Added custom field: ${field.name}`);
  };

  const handleRemoveField = (id: string) => {
    setCustomFields(customFields.filter(f => f.id !== id));
    toast.success('Custom field removed');
  };

  const handleExport = () => {
    const baseHeaders = ['Code', 'Name', 'Account Type', 'Interest Rate', 'Commission', 'Ledger Balance', 'Deposits', 'Withdrawals', 'Buy', 'Sell', 'Net Sell', 'Adjusted Ledger', 'Accrued Interest', 'Receivable (from Broker)', 'Payable (to Broker)', 'Brokerage Amt'];
    const customHeaders = customFields.map(f => f.name);
    const headers = [...baseHeaders, ...customHeaders];
    
    const csvData = accountingData.map(row => {
      const baseData = [
        row.investor_code,
        row.investor_name,
        row.account_type,
        row.interest_rate,
        row.brokerage_commission,
        row.ledger_balance,
        row.total_deposits,
        row.total_withdrawals,
        row.gross_buy,
        row.gross_sell,
        row.net_sell,
        row.adjusted_ledger,
        row.accrued_interest,
        row.receivable,
        row.payable,
        row.brokerage_amount,
      ];
      const customData = customFields.map(f => row[f.id] || 0);
      return [...baseData, ...customData];
    });
    
    const csv = [headers.join(','), ...csvData.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounting_${fromDateStr}_to_${toDateStr}.csv`;
    a.click();
  };

  const toggleColumnVisibility = (columnId: string) => {
    setColumns(cols => cols.map(c => 
      c.id === columnId ? { ...c, visible: !c.visible } : c
    ));
  };

  const moveColumn = (columnId: string, direction: 'up' | 'down') => {
    setColumns(cols => {
      const index = cols.findIndex(c => c.id === columnId);
      if (index === -1) return cols;
      if (direction === 'up' && index === 0) return cols;
      if (direction === 'down' && index === cols.length - 1) return cols;
      
      const newCols = [...cols];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newCols[index], newCols[swapIndex]] = [newCols[swapIndex], newCols[index]];
      return newCols;
    });
  };

  const visibleColumns = columns.filter(c => c.visible);

  const getCellValue = (row: AccountingRow, columnId: string) => {
    const value = row[columnId];
    if (columnId === 'investor_code' || columnId === 'investor_name' || columnId === 'account_type') {
      return value;
    }
    if (typeof value === 'number') {
      if (columnId === 'interest_rate' || columnId === 'brokerage_commission') {
        return value.toFixed(4);
      }
      return value > 0 || value < 0 ? formatCurrency(value) : '-';
    }
    return value || '-';
  };

  const getCellClassName = (row: AccountingRow, column: ColumnConfig) => {
    const value = row[column.id];
    const baseClass = column.align === 'right' ? 'text-right' : '';
    
    if (column.id === 'investor_code') return `${baseClass} font-mono`;
    if (column.id === 'investor_name') return `${baseClass} truncate max-w-[200px]`;
    if (column.id === 'ledger_balance' && typeof value === 'number' && value < 0) return `${baseClass} text-red-400`;
    if (column.id === 'adjusted_ledger' && typeof value === 'number' && value < 0) return `${baseClass} font-medium text-red-400`;
    if (column.id === 'adjusted_ledger') return `${baseClass} font-medium`;
    if (column.id === 'net_sell' && typeof value === 'number') {
      if (value > 0) return `${baseClass} text-green-400`;
      if (value < 0) return `${baseClass} text-red-400`;
    }
    if (column.colorClass && typeof value === 'number' && value !== 0) return `${baseClass} ${column.colorClass}`;
    
    return baseClass;
  };

  return (
    <div className="space-y-4 lg:space-y-6 w-full overflow-x-hidden">
      {/* Summary Cards - Sticky */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-3 lg:pb-4 -mx-4 px-4 pt-2">
        {/* Department Charts - Clickable Toggle */}
        <Card className="mt-4 glass-card">
          <CardContent className="p-4">
            {/* Chart View Tabs */}
            <div className="flex gap-1 mb-4 p-1 bg-muted/30 rounded-lg w-fit">
              <button
                onClick={() => setChartView('turnover')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  chartView === 'turnover' 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Turnover
              </button>
              <button
                onClick={() => setChartView('margin')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  chartView === 'margin' 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Margin Loan
              </button>
              <button
                onClick={() => setChartView('commission')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  chartView === 'commission' 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Commission
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
              {/* Turnover View */}
              {chartView === 'turnover' && departmentTurnover && departmentTurnover.length > 0 && (
                <>
                  {/* Pie Chart */}
                  <div className="flex-shrink-0">
                    <h4 className="text-sm font-semibold mb-2">Turnover by Department</h4>
                    <div className="h-48 w-full lg:w-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={(() => {
                              const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                              return departmentTurnover.map((dept: { department: string; turnover: number }, index: number) => ({
                                name: dept.department || 'Unknown',
                                value: Number(dept.turnover),
                                color: COLORS[index % COLORS.length]
                              }));
                            })()}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {(() => {
                              const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                              return departmentTurnover.map((_: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ));
                            })()}
                          </Pie>
                          <Tooltip 
                            formatter={(value: number) => formatCurrency(value)}
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--popover))', 
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '6px',
                              fontSize: '12px'
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Trade Summary */}
                  <div className="flex-shrink-0 lg:border-l lg:border-border lg:pl-4">
                    <h4 className="text-sm font-semibold mb-2">Trade Summary</h4>
                    <div className="space-y-2">
                      <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                        <span className="text-xs text-muted-foreground">Total Turnover</span>
                        <p className="text-xl font-bold text-primary">
                          {formatCurrency(departmentTurnover.reduce((sum: number, d: { turnover: number }) => sum + Number(d.turnover), 0))}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                          <span className="text-xs text-muted-foreground">Total Buy</span>
                          <p className="text-sm font-semibold text-red-400">
                            {formatCurrency(departmentTurnover.reduce((sum: number, d: { total_buy: number }) => sum + Number(d.total_buy), 0))}
                          </p>
                        </div>
                        <div className="flex-1 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                          <span className="text-xs text-muted-foreground">Total Sell</span>
                          <p className="text-sm font-semibold text-green-400">
                            {formatCurrency(departmentTurnover.reduce((sum: number, d: { total_sell: number }) => sum + Number(d.total_sell), 0))}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Department List */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold mb-2">Department Breakdown</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                      {(() => {
                        const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                        const totalTurnover = departmentTurnover.reduce((sum: number, d: { turnover: number }) => sum + Number(d.turnover), 0);
                        
                        return departmentTurnover.map((dept: { department: string; total_buy: number; total_sell: number; turnover: number }, index: number) => {
                          const sharePercent = totalTurnover > 0 ? (Number(dept.turnover) / totalTurnover) * 100 : 0;
                          return (
                            <div key={index} className="p-2 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full shrink-0" 
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-medium truncate">{dept.department || 'Unknown'}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold ml-1">
                                    {sharePercent.toFixed(1)}%
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground">{formatCurrency(Number(dept.turnover))}</span>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </>
              )}

              {/* Margin Loan View */}
              {chartView === 'margin' && (
                <>
                  {/* Pie Chart - showing ending loan distribution */}
                  <div className="flex-shrink-0">
                    <h4 className="text-sm font-semibold mb-2">Margin Loan Distribution</h4>
                    <div className="h-48 w-full lg:w-64">
                      {balanceComparison && balanceComparison.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={(() => {
                                const COLORS = ['hsl(var(--destructive))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                                return balanceComparison.map((dept: { department: string; ending_loan: number }, index: number) => ({
                                  name: dept.department || 'Unknown',
                                  value: Number(dept.ending_loan),
                                  color: COLORS[index % COLORS.length]
                                }));
                              })()}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              {(() => {
                                const COLORS = ['hsl(var(--destructive))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                                return balanceComparison.map((_: any, index: number) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ));
                              })()}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => formatCurrency(value)}
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--popover))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px',
                                fontSize: '12px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                          No margin loan data available
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Margin Loan Summary */}
                  <div className="flex-shrink-0 lg:border-l lg:border-border lg:pl-4">
                    <h4 className="text-sm font-semibold mb-2">Margin Loan Summary</h4>
                    <div className="space-y-2">
                      <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                        <span className="text-xs text-muted-foreground">Beginning Loan</span>
                        <p className="text-lg font-bold">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { beginning_loan: number }) => sum + Number(d.beginning_loan), 0) || 0)}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                        <span className="text-xs text-muted-foreground">Ending Loan</span>
                        <p className="text-lg font-bold text-destructive">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { ending_loan: number }) => sum + Number(d.ending_loan), 0) || 0)}
                        </p>
                      </div>
                      <div className={cn(
                        "p-2 rounded-lg border",
                        (balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0) <= 0
                          ? "bg-green-500/10 border-green-500/20"
                          : "bg-red-500/10 border-red-500/20"
                      )}>
                        <span className="text-xs text-muted-foreground">Loan Change</span>
                        <p className={cn(
                          "text-lg font-bold flex items-center gap-1",
                          (balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0) <= 0
                            ? "text-green-400"
                            : "text-red-400"
                        )}>
                          {(balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0) <= 0 ? (
                            <TrendingDown className="h-4 w-4" />
                          ) : (
                            <TrendingUp className="h-4 w-4" />
                          )}
                          {formatCurrency(Math.abs(balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0))}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Department Loan Table */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold mb-2">Margin Loan by Department</h4>
                    <div className="max-h-56 overflow-y-auto border border-border rounded-lg">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
                          <TableRow>
                            <TableHead className="text-xs">Department</TableHead>
                            <TableHead className="text-xs text-right">Beg. Loan</TableHead>
                            <TableHead className="text-xs text-right">End Loan</TableHead>
                            <TableHead className="text-xs text-right">Change</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {balanceComparison && balanceComparison.length > 0 ? (
                            balanceComparison.map((dept: { department: string; beginning_loan: number; ending_loan: number; loan_change: number; change_percent: number; client_count: number }, index: number) => (
                              <TableRow key={index}>
                                <TableCell className="text-xs font-medium py-1.5">{dept.department || 'Unknown'}</TableCell>
                                <TableCell className="text-xs text-right py-1.5">{formatCurrency(Number(dept.beginning_loan))}</TableCell>
                                <TableCell className="text-xs text-right py-1.5">{formatCurrency(Number(dept.ending_loan))}</TableCell>
                                <TableCell className={cn(
                                  "text-xs text-right py-1.5 font-medium flex items-center justify-end gap-1",
                                  Number(dept.loan_change) <= 0 ? "text-green-400" : "text-red-400"
                                )}>
                                  {Number(dept.loan_change) <= 0 ? (
                                    <TrendingDown className="h-3 w-3" />
                                  ) : (
                                    <TrendingUp className="h-3 w-3" />
                                  )}
                                  {formatCurrency(Math.abs(Number(dept.loan_change)))}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-4">
                                No margin loan data available for this period
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}

              {/* Commission View */}
              {chartView === 'commission' && (
                <>
                  {/* Pie Chart */}
                  <div className="flex-shrink-0">
                    <h4 className="text-sm font-semibold mb-2">Commission by Department</h4>
                    <div className="h-48 w-full lg:w-64">
                      {commissionByDept && commissionByDept.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={(() => {
                                const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                                return commissionByDept.map((dept: { department: string; total_commission: number }, index: number) => ({
                                  name: dept.department || 'Unknown',
                                  value: Number(dept.total_commission),
                                  color: COLORS[index % COLORS.length]
                                }));
                              })()}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              {(() => {
                                const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                                return commissionByDept.map((_: any, index: number) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ));
                              })()}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => formatCurrency(value)}
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--popover))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px',
                                fontSize: '12px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                          No commission data available
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Commission Summary */}
                  <div className="flex-shrink-0 lg:border-l lg:border-border lg:pl-4">
                    <h4 className="text-sm font-semibold mb-2">Commission Summary</h4>
                    <div className="space-y-2">
                      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <span className="text-xs text-muted-foreground">Total Commission</span>
                        <p className="text-xl font-bold text-green-400">
                          {formatCurrency(commissionByDept?.reduce((sum: number, d: { total_commission: number }) => sum + Number(d.total_commission), 0) || 0)}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                        <span className="text-xs text-muted-foreground">Total Turnover</span>
                        <p className="text-sm font-semibold">
                          {formatCurrency(commissionByDept?.reduce((sum: number, d: { total_turnover: number }) => sum + Number(d.total_turnover), 0) || 0)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Department List */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold mb-2">Department Breakdown</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                      {commissionByDept && commissionByDept.length > 0 ? (() => {
                        const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(220, 70%, 50%)', 'hsl(280, 70%, 50%)', 'hsl(340, 70%, 50%)'];
                        const totalCommission = commissionByDept.reduce((sum: number, d: { total_commission: number }) => sum + Number(d.total_commission), 0);
                        
                        return commissionByDept.map((dept: { department: string; total_commission: number; total_turnover: number }, index: number) => {
                          const sharePercent = totalCommission > 0 ? (Number(dept.total_commission) / totalCommission) * 100 : 0;
                          return (
                            <div key={index} className="p-2 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full shrink-0" 
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-medium truncate">{dept.department || 'Unknown'}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-semibold ml-1">
                                    {sharePercent.toFixed(1)}%
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground">{formatCurrency(Number(dept.total_commission))}</span>
                              </div>
                            </div>
                          );
                        });
                      })() : (
                        <div className="col-span-3 text-center text-muted-foreground text-sm py-4">
                          No commission data available for this period
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Empty state for turnover */}
              {chartView === 'turnover' && (!departmentTurnover || departmentTurnover.length === 0) && (
                <div className="w-full text-center text-muted-foreground text-sm py-8">
                  No turnover data available for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="space-y-3 lg:space-y-4">
        {/* Search Row */}
        <div className="relative w-full lg:max-w-lg group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/5 rounded-lg blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search by code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9 h-10 bg-muted/30 border-muted-foreground/20 focus:border-primary/50 focus:bg-background transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {debouncedSearch && (
            <span className="absolute -bottom-5 left-0 text-xs text-muted-foreground">
              {totalCount} result{Number(totalCount) !== 1 ? 's' : ''} found
            </span>
          )}
        </div>

        {/* Actions Row */}
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 lg:gap-3">
          {/* Date Range Selection */}
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border/50">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-3">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(fromDate, 'dd MMM yy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-background border">
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={(d) => d && setFromDate(d)}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-3">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(toDate, 'dd MMM yy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-background border">
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={(d) => d && setToDate(d)}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Account Type Filter */}
          <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
            <SelectTrigger className="w-[120px] lg:w-[140px] h-9 bg-muted/30 border-border/50 text-sm">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="margin">Margin</SelectItem>
              <SelectItem value="cash">Cash/Regular</SelectItem>
            </SelectContent>
          </Select>

          {/* Has Trades Filter */}
          <Select value={hasTradesFilter} onValueChange={setHasTradesFilter}>
            <SelectTrigger className="w-[120px] lg:w-[140px] h-9 bg-muted/30 border-border/50 text-sm">
              <SelectValue placeholder="Activity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Activity</SelectItem>
              <SelectItem value="with_trades">With Trades</SelectItem>
              <SelectItem value="no_trades">No Trades</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-xs lg:text-sm text-muted-foreground hidden md:inline">
            Period: {format(fromDate, 'dd MMM')} - {format(toDate, 'dd MMM yyyy')}
          </span>

          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto flex-wrap">
            <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-xs lg:text-sm">
                  <Settings className="h-4 w-4 mr-1 lg:mr-2" />
                  <span className="hidden sm:inline">Custom </span>Fields
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Manage Custom Fields</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Add formula-based fields that appear as extra columns in the table.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <Label>Field Name</Label>
                      <Input
                        placeholder="e.g., Daily Interest"
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Formula</Label>
                      <Input
                        placeholder="e.g., max(0, net_sell)"
                        value={newFieldFormula}
                        onChange={(e) => setNewFieldFormula(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Fields: ledger, deposits, withdrawals, net_sell, adjusted_ledger, accrued_interest, interest_rate, receivable, payable, gross_buy, gross_sell, brokerage_amount
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Functions: ABS(), MAX(a, b), MIN(a, b)
                      </p>
                    </div>
                    <Button onClick={handleAddField} size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Field
                    </Button>
                  </div>

                  {customFields.length > 0 && (
                    <div className="border-t pt-4">
                      <Label className="mb-2 block">Current Fields</Label>
                      <div className="space-y-2">
                        {customFields.map(field => (
                          <div key={field.id} className="flex items-center justify-between p-2 bg-muted rounded">
                            <div>
                              <span className="font-medium">{field.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">= {field.formula}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveField(field.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Column Settings Dialog */}
            <Dialog open={isColumnDialogOpen} onOpenChange={setIsColumnDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-xs lg:text-sm">
                  <Eye className="h-4 w-4 mr-1 lg:mr-2" />
                  Columns
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Configure Columns</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Toggle visibility and reorder columns. Closing Balance is at the end.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {columns.map((column, index) => (
                    <div key={column.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={column.visible}
                          onCheckedChange={() => toggleColumnVisibility(column.id)}
                        />
                        <span className={cn("text-sm", !column.visible && "text-muted-foreground")}>
                          {column.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveColumn(column.id, 'up')}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveColumn(column.id, 'down')}
                          disabled={index === columns.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleExport} className="flex-1 sm:flex-none text-xs lg:text-sm">
                <Download className="h-4 w-4 mr-1 lg:mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Accounting Details
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (Click row to view reconciliation)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {visibleColumns.map(column => (
                        <TableHead 
                          key={column.id} 
                          className={cn(
                            "min-w-[100px]",
                            column.align === 'right' && "text-right",
                            column.colorClass
                          )}
                        >
                          {column.label}
                        </TableHead>
                      ))}
                      {customFields.map(field => (
                        <TableHead key={field.id} className="text-right min-w-[100px] text-primary">
                          {field.name}
                        </TableHead>
                      ))}
                      <TableHead className="w-[40px] min-w-[40px]">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0 hover:bg-primary/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsFieldDialogOpen(true);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountingData.map((row) => (
                      <TableRow 
                        key={row.investor_code}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedInvestor(row)}
                      >
                        {visibleColumns.map(column => {
                          const isClickableTrade = column.id === 'gross_buy' || column.id === 'gross_sell';
                          const cellValue = row[column.id];
                          const hasValue = typeof cellValue === 'number' && cellValue > 0;
                          
                          if (isClickableTrade && hasValue) {
                            return (
                              <TableCell 
                                key={column.id} 
                                className={cn(
                                  getCellClassName(row, column),
                                  "cursor-pointer hover:underline"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTradeInvestor(row);
                                  setSelectedTradeType(column.id === 'gross_buy' ? 'BUY' : 'SELL');
                                  setTradeDetailsOpen(true);
                                }}
                              >
                                {getCellValue(row, column.id)}
                              </TableCell>
                            );
                          }
                          
                          return (
                            <TableCell 
                              key={column.id} 
                              className={getCellClassName(row, column)}
                            >
                              {getCellValue(row, column.id)}
                            </TableCell>
                          );
                        })}
                        {customFields.map(field => (
                          <TableCell key={field.id} className="text-right">
                            {formatCurrency(Number(row[field.id]) || 0)}
                          </TableCell>
                        ))}
                        <TableCell></TableCell>
                      </TableRow>
                    ))}
                    {accountingData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={visibleColumns.length + customFields.length + 1} className="text-center py-8 text-muted-foreground">
                          {debouncedSearch ? 'No investors found matching your search' : 'No accounting data available'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t">
                  <span className="text-sm text-muted-foreground">
                    Showing {currentPage * PAGE_SIZE + 1} - {Math.min((currentPage + 1) * PAGE_SIZE, Number(totalCount))} of {Number(totalCount).toLocaleString()} records
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground px-2">
                      Page {currentPage + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={currentPage >= totalPages - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation Dialog */}
      {selectedInvestor && (
        <AccountingReconciliationDialog
          investor={selectedInvestor}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setSelectedInvestor(null)}
        />
      )}

      {/* Trade Details Dialog */}
      {selectedTradeInvestor && (
        <TradeDetailsDialog
          investorCode={selectedTradeInvestor.investor_code}
          investorName={selectedTradeInvestor.investor_name}
          tradeType={selectedTradeType}
          fromDate={fromDate}
          toDate={toDate}
          open={tradeDetailsOpen}
          onOpenChange={setTradeDetailsOpen}
        />
      )}
    </div>
  );
};

export default AccountingTab;
