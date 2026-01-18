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
import { format, subDays, differenceInDays, parseISO } from "date-fns";
import { Search, Download, Wallet, TrendingUp, TrendingDown, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText, ArrowDownToLine, ArrowUpFromLine, Eye, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Calculator, DollarSign, ArrowDownRight, ArrowUpRight, Award, ArrowUpDown, GripVertical, AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/balance-utils";
import { toast } from "sonner";
import { AccountingReconciliationDialog } from "./AccountingReconciliationDialog";
import { TradeDetailsDialog } from "./TradeDetailsDialog";
import { useDebounce } from "@/hooks/useDebounce";
import { rpcWithRetry, formatRpcError } from "@/lib/rpc-utils";

export interface AccountingRow {
  investor_code: string;
  investor_name: string;
  account_type: string;
  rm_name: string;
  department: string;
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
const COLUMNS_STORAGE_KEY = 'accounting-columns-config-v3';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'investor_code', label: 'Code', visible: true, align: 'left' },
  { id: 'investor_name', label: 'Name', visible: true, align: 'left' },
  { id: 'account_type', label: 'Account Type', visible: true, align: 'left' },
  { id: 'rm_name', label: 'RM', visible: true, align: 'left' },
  { id: 'department', label: 'Department', visible: true, align: 'left' },
  { id: 'ledger_balance', label: 'Opening Bal', visible: true, align: 'right' },
  { id: 'total_deposits', label: 'Deposits', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'total_withdrawals', label: 'Withdrawals', visible: true, align: 'right', colorClass: 'text-amber-400' },
  { id: 'gross_buy', label: 'Gross Buy', visible: true, align: 'right', colorClass: 'text-red-400' },
  { id: 'gross_sell', label: 'Gross Sell', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'final_balance', label: 'Closing Balance', visible: true, align: 'right', colorClass: 'text-blue-400' },
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

type ChartView = 'margin' | 'commission';

const AccountingTab = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldFormula, setNewFieldFormula] = useState("");
  const [chartView, setChartView] = useState<ChartView>('commission');
  const [selectedInvestor, setSelectedInvestor] = useState<AccountingRow | null>(null);
  // Default to today only (single day) to prevent timeouts
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [selectedTradeType, setSelectedTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [selectedTradeInvestor, setSelectedTradeInvestor] = useState<AccountingRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>("investor_code");
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dateRangeWarning, setDateRangeWarning] = useState<string | null>(null);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [activityFilter, setActivityFilter] = useState<string>("with_trades");

  // Calculate date range in days for guardrails
  const dateRangeDays = useMemo(() => differenceInDays(toDate, fromDate) + 1, [fromDate, toDate]);
  const isLargeRange = dateRangeDays > 7;

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
        .maybeSingle();
      setIsAdmin(!!roleData);
    };
    checkAdmin();
  }, []);

  // Initialize with latest trade date on mount
  useEffect(() => {
    const fetchLatestTradeDate = async () => {
      const { data } = await supabase
        .from('trade_history')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data?.trade_date) {
        // trade_date is in YYYYMMDD format
        const dateStr = data.trade_date;
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        const latestDate = new Date(year, month, day);
        setFromDate(latestDate);
        setToDate(latestDate);
      }
    };
    fetchLatestTradeDate();
  }, []);

  // Update date range warning
  useEffect(() => {
    if (isLargeRange) {
      setDateRangeWarning(`Large date range (${dateRangeDays} days) may load slowly.`);
    } else {
      setDateRangeWarning(null);
    }
  }, [dateRangeDays, isLargeRange]);

  // Debounce search term for server-side search
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Handler to sync toDate when fromDate changes (single day mode)
  const handleFromDateChange = (date: Date | undefined) => {
    if (date) {
      setFromDate(date);
      // If user selects a from date after the to date, sync them
      if (date > toDate) {
        setToDate(date);
      }
    }
  };

  // Handler to set single day mode
  const handleSetSingleDay = () => {
    setToDate(fromDate);
  };

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
  const endDateStr = format(toDate, 'yyyy-MM-dd'); // End date (inclusive)
  const openingDateStr = format(subDays(fromDate, 1), 'yyyy-MM-dd'); // Opening balance date (start date - 1 day EOD)

  // Fetch accounting data using optimized RPC function v3
  const { data: accountingResult, isLoading: loadingData, isError, error: queryError, refetch } = useQuery({
    queryKey: ['accounting-data-v3', debouncedSearch, endDateStr, openingDateStr, accountTypeFilter, activityFilter],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await rpcWithRetry<any[]>('get_accounting_data_v3', {
          _opening_date: openingDateStr,
          _tx_date: endDateStr,
          _search: debouncedSearch || '',
          _account_type_filter: accountTypeFilter || 'all',
          _has_activity_filter: activityFilter || 'all',
          _limit: PAGE_SIZE,
          _offset: offset,
        });
        
        if (error) throw error;
        if (data) allData = [...allData, ...data];
        hasMore = data?.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      console.log('[AccountingTab] Fetched total:', allData.length, 'rows via v3');
      return allData;
    },
    retry: (failureCount, error: Error) => {
      const msg = error?.message || '';
      // Don't retry on schema errors - they need code fixes
      if (msg.includes('does not exist') || msg.includes('column')) return false;
      // Don't retry on timeout errors - suggest narrowing date range instead
      if (msg.includes('timeout') || msg.includes('57014')) return false;
      return failureCount < 2;
    },
  });

  // Check if error is a timeout
  const isTimeoutError = useMemo(() => {
    if (!queryError) return false;
    const msg = (queryError as Error)?.message || '';
    return msg.includes('timeout') || msg.includes('57014') || msg.includes('canceling statement');
  }, [queryError]);

  // Summary data can be computed locally from accountingResult
  const loadingSummary = loadingData;

  // Fetch turnover by department
  const { data: departmentTurnover } = useQuery({
    queryKey: ['accounting-turnover-by-department', openingDateStr, endDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_accounting_turnover_by_department', {
        _from_tx_date: format(fromDate, 'yyyy-MM-dd'),
        _to_tx_date: endDateStr,
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch balance comparison by department (period beginning vs ending)
  const { data: balanceComparison } = useQuery({
    queryKey: ['accounting-balance-comparison', openingDateStr, endDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_composition_by_department', {
        p_from_date: openingDateStr,
        p_to_date: endDateStr,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: chartView === 'margin',
  });

  // Fetch commission by department
  const { data: commissionByDept } = useQuery({
    queryKey: ['accounting-commission-by-department', openingDateStr, endDateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_commission_by_department', {
        _from_tx_date: format(fromDate, 'yyyy-MM-dd'),
        _to_tx_date: endDateStr,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: chartView === 'commission',
  });

  // Process accounting data with custom fields (filtering now done server-side)
  const accountingData = useMemo(() => {
    if (!accountingResult) {
      console.log('[AccountingTab] No accountingResult yet');
      return [];
    }
    
    console.log('[AccountingTab] Processing', accountingResult.length, 'rows');
    
    return accountingResult.map((row: any) => {
      const processedRow: AccountingRow = {
        investor_code: row.investor_code || '',
        investor_name: row.investor_name || '',
        account_type: row.account_type || '',
        rm_name: row.rm_name || '',
        department: row.department || '',
        interest_rate: 0,
        brokerage_commission: 0,
        // Backend returns: opening_balance, deposits, withdrawals, gross_buy, gross_sell, closing_balance
        ledger_balance: Number(row.opening_balance ?? row.ledger_balance) || 0,
        total_deposits: Number(row.deposits ?? row.total_deposits) || 0,
        total_withdrawals: Number(row.withdrawals ?? row.total_withdrawals) || 0,
        gross_buy: Number(row.gross_buy) || 0,
        gross_sell: Number(row.gross_sell) || 0,
        net_buy: Number(row.gross_buy) || 0,
        net_sell: Number(row.gross_sell) || 0,
        adjusted_ledger: 0,
        accrued_interest: 0,
        brokerage_amount: 0,
        final_balance: Number(row.closing_balance ?? row.final_balance) || 0,
        receivable: 0,
        payable: 0,
      };

      // Calculate custom fields
      customFields.forEach(field => {
        processedRow[field.id] = evaluateFormula(field.formula, processedRow);
      });

      return processedRow;
    });
  }, [accountingResult, customFields]);

  // Get total count from first row (all rows have the same total_count)
  const totalCount = (accountingResult?.[0] as any)?.total_count || accountingResult?.length || 0;

  // Summary data computed from accountingData
  const summary = useMemo(() => {
    if (!accountingData || accountingData.length === 0) {
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
      totalAccounts: accountingData.length,
      marginAccounts: 0,
      totalMarginLoan: 0,
      totalAccruedInterest: 0,
      totalReceivable: 0,
      totalPayable: 0,
      totalBuy: accountingData.reduce((sum, row) => sum + (row.gross_buy || 0), 0),
      totalSell: accountingData.reduce((sum, row) => sum + (row.gross_sell || 0), 0),
      totalTradeValue: accountingData.reduce((sum, row) => sum + (row.gross_buy || 0) + (row.gross_sell || 0), 0),
    };
  }, [accountingData]);

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

  const handleExport = async () => {
    const toastId = toast.loading('Preparing export...');
    
    try {
      // Use already fetched data for export (no pagination)
      const allData = accountingResult || [];
      const error = null;

      if (error) throw error;

      // Process data with custom fields
      const processedData = (allData || []).map((row: any) => {
        const processed = { ...row } as AccountingRow;
        customFields.forEach(field => {
          processed[field.id] = evaluateFormula(field.formula, processed);
        });
        return processed;
      });

      const baseHeaders = ['Code', 'Name', 'Account Type', 'Interest Rate', 'Commission', 'Ledger Balance', 'Deposits', 'Withdrawals', 'Buy', 'Sell', 'Net Sell', 'Adjusted Ledger', 'Accrued Interest', 'Receivable (from Broker)', 'Payable (to Broker)', 'Brokerage Amt'];
      const customHeaders = customFields.map(f => f.name);
      const headers = [...baseHeaders, ...customHeaders];
      
      const csvData = processedData.map(row => {
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
      a.download = dateRangeDays > 1
        ? `accounting_${format(fromDate, 'yyyy-MM-dd')}_to_${endDateStr}.csv`
        : `accounting_${endDateStr}.csv`;
      a.click();
      
      toast.dismiss(toastId);
      toast.success(`Exported ${processedData.length} records`);
    } catch (err) {
      console.error('Export error:', err);
      toast.dismiss(toastId);
      toast.error('Failed to export data');
    }
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

  // Sort handler - triggers server-side sort
  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  };

  // Drag and drop handlers for column reordering
  const handleDragStart = (columnId: string) => {
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;

    setColumns(cols => {
      const draggedIndex = cols.findIndex(c => c.id === draggedColumn);
      const targetIndex = cols.findIndex(c => c.id === targetColumnId);
      if (draggedIndex === -1 || targetIndex === -1) return cols;

      const newCols = [...cols];
      const [removed] = newCols.splice(draggedIndex, 1);
      newCols.splice(targetIndex, 0, removed);
      return newCols;
    });
    setDraggedColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
  };

  // Client-side sorting for all columns
  const sortedData = useMemo(() => {
    return [...accountingData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      // Handle string columns (investor_code, investor_name, account_type)
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      
      // Handle numeric columns (including final_balance / Closing Balance)
      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });
  }, [accountingData, sortColumn, sortDirection]);

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
      {/* Error Display */}
      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{formatRpcError(queryError as Error)}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards - Sticky */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-3 lg:pb-4 -mx-4 px-4 pt-2">
        {/* Department Charts - Clickable Toggle */}
        <Card className="mt-4 glass-card">
          <CardContent className="p-4">
            {/* Chart View Tabs */}
            <div className="flex gap-1 mb-4 p-1 bg-muted/30 rounded-lg w-fit">
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
              {/* Margin Loan View */}
              {chartView === 'margin' && (
                <div className="w-full space-y-6">
                  {/* Date Range Indicator */}
                  {balanceComparison && balanceComparison.length > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5 border border-border/50">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        <span className="font-medium">Comparing:</span>
                        <span className="text-foreground">{balanceComparison[0]?.actual_from_date ? format(new Date(balanceComparison[0].actual_from_date), 'MMM dd, yyyy') : 'N/A'}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="text-foreground">{balanceComparison[0]?.actual_to_date ? format(new Date(balanceComparison[0].actual_to_date), 'MMM dd, yyyy') : 'N/A'}</span>
                      </div>
                      {/* Warning if same date */}
                      {balanceComparison[0]?.actual_from_date === balanceComparison[0]?.actual_to_date && (
                        <div className="flex items-center gap-2 text-xs bg-amber-500/10 text-amber-400 rounded-lg px-3 py-1.5 border border-amber-500/20">
                          <FileText className="h-3.5 w-3.5" />
                          <span>Same date - no comparison available</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* KPI Metrics Row */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Beginning Loan Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-500/20 via-slate-500/10 to-transparent border border-slate-500/30 p-4 group hover:border-slate-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-slate-500/20">
                            <Wallet className="h-4 w-4 text-slate-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">
                            OPENING
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Beginning Loan</p>
                        <p className="text-2xl font-bold text-slate-300">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { beginning_loan: number }) => sum + Number(d.beginning_loan), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400/80">
                          <span>{balanceComparison?.length || 0} departments</span>
                        </div>
                      </div>
                    </div>

                    {/* Ending Loan Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-rose-500/20 via-rose-500/10 to-transparent border border-rose-500/30 p-4 group hover:border-rose-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-rose-500/20">
                            <TrendingUp className="h-4 w-4 text-rose-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            CLOSING
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Ending Loan</p>
                        <p className="text-2xl font-bold text-rose-400">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { ending_loan: number }) => sum + Number(d.ending_loan), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-rose-400/80">
                          <span>Current outstanding</span>
                        </div>
                      </div>
                    </div>

                    {/* Loan Change Card */}
                    {(() => {
                      const totalChange = balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0;
                      const isPositiveChange = totalChange <= 0; // Decrease in loan is positive
                      return (
                        <div className={cn(
                          "relative overflow-hidden rounded-xl p-4 group transition-all duration-300",
                          isPositiveChange 
                            ? "bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent border border-emerald-500/30 hover:border-emerald-500/50"
                            : "bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent border border-red-500/30 hover:border-red-500/50"
                        )}>
                          <div className={cn(
                            "absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl transform translate-x-8 -translate-y-8",
                            isPositiveChange ? "bg-emerald-500/10" : "bg-red-500/10"
                          )} />
                          <div className="relative">
                            <div className="flex items-center justify-between mb-2">
                              <div className={cn(
                                "p-2 rounded-lg",
                                isPositiveChange ? "bg-emerald-500/20" : "bg-red-500/20"
                              )}>
                                {isPositiveChange ? (
                                  <TrendingDown className="h-4 w-4 text-emerald-400" />
                                ) : (
                                  <TrendingUp className="h-4 w-4 text-red-400" />
                                )}
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                                isPositiveChange 
                                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                  : "bg-red-500/20 text-red-400 border-red-500/30"
                              )}>
                                {isPositiveChange ? 'DECREASED' : 'INCREASED'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">Net Change</p>
                            <p className={cn(
                              "text-2xl font-bold flex items-center gap-1",
                              isPositiveChange ? "text-emerald-400" : "text-red-400"
                            )}>
                              {isPositiveChange ? '-' : '+'}{formatCurrency(Math.abs(totalChange))}
                            </p>
                            <div className={cn(
                              "mt-2 flex items-center gap-1 text-xs",
                              isPositiveChange ? "text-emerald-400/80" : "text-red-400/80"
                            )}>
                              <span>{isPositiveChange ? 'Liability reduced' : 'Liability increased'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Change Percentage Card */}
                    {(() => {
                      const beginningTotal = balanceComparison?.reduce((sum: number, d: { beginning_loan: number }) => sum + Number(d.beginning_loan), 0) || 0;
                      const totalChange = balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0;
                      const changePercent = beginningTotal > 0 ? (totalChange / beginningTotal) * 100 : 0;
                      const isPositive = changePercent <= 0;
                      return (
                        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/20 via-violet-500/10 to-transparent border border-violet-500/30 p-4 group hover:border-violet-500/50 transition-all duration-300">
                          <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                          <div className="relative">
                            <div className="flex items-center justify-between mb-2">
                              <div className="p-2 rounded-lg bg-violet-500/20">
                                <Percent className="h-4 w-4 text-violet-400" />
                              </div>
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                                RATE
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">Change Rate</p>
                            <p className={cn(
                              "text-2xl font-bold",
                              isPositive ? "text-emerald-400" : "text-red-400"
                            )}>
                              {isPositive && changePercent !== 0 ? '' : ''}{changePercent.toFixed(2)}%
                            </p>
                            <div className="mt-2 flex items-center gap-1 text-xs text-violet-400/80">
                              <span>Period-over-period</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Charts and Table Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Enhanced Pie Chart */}
                    <div className="lg:col-span-1 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Distribution</h4>
                        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
                          By Department
                        </span>
                      </div>
                      <div className="h-56 w-full">
                        {balanceComparison && balanceComparison.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <defs>
                                <linearGradient id="loanGrad1" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(350, 89%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(350, 89%, 45%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad2" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(217, 91%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(217, 91%, 45%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad3" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(43, 96%, 56%)" />
                                  <stop offset="100%" stopColor="hsl(43, 96%, 40%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad4" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(280, 87%, 65%)" />
                                  <stop offset="100%" stopColor="hsl(280, 87%, 50%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad5" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(160, 84%, 39%)" />
                                  <stop offset="100%" stopColor="hsl(160, 84%, 29%)" />
                                </linearGradient>
                              </defs>
                              <Pie
                                data={balanceComparison.map((dept: { department: string; ending_loan: number }, index: number) => ({
                                  name: dept.department || 'Unknown',
                                  value: Number(dept.ending_loan),
                                }))}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={85}
                                paddingAngle={3}
                                dataKey="value"
                                stroke="none"
                              >
                                {balanceComparison.map((_: any, index: number) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={`url(#loanGrad${(index % 5) + 1})`}
                                    className="drop-shadow-lg"
                                  />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value: number) => formatCurrency(value)}
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--popover))', 
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '12px',
                                  fontSize: '12px',
                                  boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
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

                    {/* Department Breakdown Table - Enhanced */}
                    <div className="lg:col-span-2 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Department Breakdown</h4>
                        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
                          {balanceComparison?.length || 0} Departments
                        </span>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {balanceComparison && balanceComparison.length > 0 ? (
                          <div className="space-y-2">
                            {balanceComparison
                              .sort((a: { ending_loan: number }, b: { ending_loan: number }) => Number(b.ending_loan) - Number(a.ending_loan))
                              .map((dept: { department: string; beginning_loan: number; ending_loan: number; loan_change: number; change_percent: number; client_count: number }, index: number) => {
                                const maxLoan = Math.max(...balanceComparison.map((d: { ending_loan: number }) => Number(d.ending_loan)));
                                const barWidth = maxLoan > 0 ? (Number(dept.ending_loan) / maxLoan) * 100 : 0;
                                const isDecrease = Number(dept.loan_change) <= 0;
                                
                                return (
                                  <div 
                                    key={index}
                                    className={cn(
                                      "relative p-3 rounded-lg border transition-all duration-200 hover:border-border group",
                                      index % 2 === 0 ? "bg-muted/20" : "bg-transparent",
                                      "border-border/30"
                                    )}
                                  >
                                    {/* Background bar showing distribution */}
                                    <div 
                                      className="absolute left-0 top-0 h-full rounded-lg bg-gradient-to-r from-rose-500/10 to-transparent transition-all duration-500"
                                      style={{ width: `${barWidth}%` }}
                                    />
                                    
                                    <div className="relative flex items-center gap-3">
                                      {/* Rank Badge */}
                                      <div className={cn(
                                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                                        index === 0 ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30" :
                                        index === 1 ? "bg-slate-400/20 text-slate-400 ring-1 ring-slate-400/30" :
                                        index === 2 ? "bg-orange-600/20 text-orange-400 ring-1 ring-orange-600/30" :
                                        "bg-muted/50 text-muted-foreground"
                                      )}>
                                        {index + 1}
                                      </div>

                                      {/* Department Info */}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{dept.department || 'Unknown'}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                          {dept.client_count || 0} clients
                                        </p>
                                      </div>

                                      {/* Loan Values */}
                                      <div className="flex items-center gap-4 text-right">
                                        <div className="hidden sm:block">
                                          <p className="text-[10px] text-muted-foreground">Beginning</p>
                                          <p className="text-xs font-medium text-slate-400">
                                            {formatCurrency(Number(dept.beginning_loan))}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] text-muted-foreground">Ending</p>
                                          <p className="text-sm font-bold text-rose-400">
                                            {formatCurrency(Number(dept.ending_loan))}
                                          </p>
                                        </div>
                                        <div className={cn(
                                          "flex flex-col items-end px-2 py-1 rounded-lg",
                                          isDecrease ? "bg-emerald-500/10" : "bg-red-500/10"
                                        )}>
                                          <div className={cn(
                                            "flex items-center gap-1 text-xs font-semibold",
                                            isDecrease ? "text-emerald-400" : "text-red-400"
                                          )}>
                                            {isDecrease ? (
                                              <ArrowDownToLine className="h-3 w-3" />
                                            ) : (
                                              <ArrowUpFromLine className="h-3 w-3" />
                                            )}
                                            {formatCurrency(Math.abs(Number(dept.loan_change)))}
                                          </div>
                                          <p className={cn(
                                            "text-[10px]",
                                            isDecrease ? "text-emerald-400/70" : "text-red-400/70"
                                          )}>
                                            {Number(dept.change_percent).toFixed(1)}%
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                            No margin loan data available for this period
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Info/Warning Messages */}
                  {balanceComparison && balanceComparison.length > 0 && 
                    balanceComparison[0]?.actual_from_date !== balanceComparison[0]?.actual_to_date &&
                    (balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0) === 0 && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20">
                      <div className="p-2 rounded-lg bg-blue-500/20">
                        <FileText className="h-4 w-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-blue-400">No Changes Detected</p>
                        <p className="text-xs text-blue-400/70">
                          The margin loan balance remained unchanged between the comparison dates. This may indicate identical data snapshots.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Commission View - Premium Design */}
              {chartView === 'commission' && (
                <div className="w-full space-y-6">
                  {/* KPI Metrics Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Total Commission Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent border border-emerald-500/30 p-4 group hover:border-emerald-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-emerald-500/20">
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            REVENUE
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Commission</p>
                        <p className="text-2xl font-bold text-emerald-400">
                          {formatCurrency(commissionByDept?.reduce((sum: number, d: { total_commission: number }) => sum + Number(d.total_commission), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400/80">
                          <span className="inline-flex items-center gap-0.5">
                            <DollarSign className="h-3 w-3" />
                            {commissionByDept?.length || 0} departments
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Total Turnover Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent border border-blue-500/30 p-4 group hover:border-blue-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-blue-500/20">
                            <ArrowDownRight className="h-4 w-4 text-blue-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            VOLUME
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Turnover</p>
                        <p className="text-2xl font-bold text-blue-400">
                          {formatCurrency(commissionByDept?.reduce((sum: number, d: { total_turnover: number }) => sum + Number(d.total_turnover || 0), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-blue-400/80">
                          <span>Across all departments</span>
                        </div>
                      </div>
                    </div>

                    {/* Trade Count Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-transparent border border-amber-500/30 p-4 group hover:border-amber-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-amber-500/20">
                            <ArrowUpRight className="h-4 w-4 text-amber-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            ACTIVITY
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
                        <p className="text-2xl font-bold text-amber-400">
                          {(commissionByDept?.reduce((sum: number, d: { trade_count: number }) => sum + Number(d.trade_count || 0), 0) || 0).toLocaleString()}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-amber-400/80">
                          <span>Executed transactions</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Charts and Table Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Enhanced Pie Chart */}
                    <div className="lg:col-span-1 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Distribution</h4>
                        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
                          By Department
                        </span>
                      </div>
                      <div className="h-56 w-full">
                        {commissionByDept && commissionByDept.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <defs>
                                <linearGradient id="commGrad1" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(160, 84%, 39%)" />
                                  <stop offset="100%" stopColor="hsl(160, 84%, 29%)" />
                                </linearGradient>
                                <linearGradient id="commGrad2" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(217, 91%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(217, 91%, 45%)" />
                                </linearGradient>
                                <linearGradient id="commGrad3" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(43, 96%, 56%)" />
                                  <stop offset="100%" stopColor="hsl(43, 96%, 40%)" />
                                </linearGradient>
                                <linearGradient id="commGrad4" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(280, 87%, 65%)" />
                                  <stop offset="100%" stopColor="hsl(280, 87%, 50%)" />
                                </linearGradient>
                                <linearGradient id="commGrad5" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(350, 89%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(350, 89%, 45%)" />
                                </linearGradient>
                              </defs>
                              <Pie
                                data={commissionByDept.map((dept: { department: string; total_commission: number }, index: number) => ({
                                  name: dept.department || 'Unknown',
                                  value: Number(dept.total_commission),
                                }))}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={85}
                                paddingAngle={3}
                                dataKey="value"
                                stroke="none"
                              >
                                {commissionByDept.map((_: any, index: number) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={`url(#commGrad${(index % 5) + 1})`}
                                    className="drop-shadow-lg"
                                  />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value: number) => formatCurrency(value)}
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--popover))', 
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '12px',
                                  fontSize: '12px',
                                  boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
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

                    {/* Department Breakdown Table */}
                    <div className="lg:col-span-2 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Department Performance</h4>
                        {commissionByDept && commissionByDept.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <Award className="h-3 w-3" />
                              Top: {commissionByDept[0]?.department || 'N/A'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-border/30">
                        <Table>
                          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                            <TableRow className="border-border/30">
                              <TableHead className="text-xs font-semibold text-muted-foreground">#</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground">Department</TableHead>
                              <TableHead className="text-xs text-right font-semibold text-muted-foreground">Commission</TableHead>
                              <TableHead className="text-xs text-right font-semibold text-muted-foreground">Turnover</TableHead>
                              <TableHead className="text-xs text-right font-semibold text-muted-foreground">Share</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {commissionByDept && commissionByDept.length > 0 ? (() => {
                              const totalCommission = commissionByDept.reduce((sum: number, d: { total_commission: number }) => sum + Number(d.total_commission), 0);
                              const GRADIENT_COLORS = [
                                'from-emerald-500/20 to-emerald-500/5',
                                'from-blue-500/20 to-blue-500/5',
                                'from-amber-500/20 to-amber-500/5',
                                'from-purple-500/20 to-purple-500/5',
                                'from-rose-500/20 to-rose-500/5',
                              ];
                              const BADGE_COLORS = [
                                'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                                'bg-blue-500/20 text-blue-400 border-blue-500/30',
                                'bg-amber-500/20 text-amber-400 border-amber-500/30',
                                'bg-purple-500/20 text-purple-400 border-purple-500/30',
                                'bg-rose-500/20 text-rose-400 border-rose-500/30',
                              ];
                              
                              return commissionByDept.map((dept: { department: string; total_commission: number; total_turnover: number }, index: number) => {
                                const sharePercent = totalCommission > 0 ? (Number(dept.total_commission) / totalCommission) * 100 : 0;
                                const isTop3 = index < 3;
                                return (
                                  <TableRow 
                                    key={index} 
                                    className={cn(
                                      "border-border/20 transition-colors hover:bg-muted/30",
                                      index % 2 === 0 ? "bg-muted/10" : "bg-transparent"
                                    )}
                                  >
                                    <TableCell className="py-3">
                                      {isTop3 ? (
                                        <span className={cn(
                                          "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                                          index === 0 ? "bg-gradient-to-br from-yellow-400 to-amber-500 text-black" :
                                          index === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-black" :
                                          "bg-gradient-to-br from-amber-600 to-amber-700 text-white"
                                        )}>
                                          {index + 1}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-muted-foreground pl-2">{index + 1}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-3">
                                      <div className="flex items-center gap-2">
                                        <div className={cn(
                                          "w-2 h-8 rounded-full bg-gradient-to-b",
                                          GRADIENT_COLORS[index % GRADIENT_COLORS.length]
                                        )} />
                                        <span className="text-sm font-medium">{dept.department || 'Unknown'}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-right">
                                      <span className={cn(
                                        "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border",
                                        BADGE_COLORS[index % BADGE_COLORS.length]
                                      )}>
                                        <DollarSign className="h-3 w-3" />
                                        {formatCurrency(Number(dept.total_commission))}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 text-right">
                                      <span className="text-xs text-muted-foreground">
                                        {formatCurrency(Number(dept.total_turnover))}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <div className="w-16 h-2 bg-muted/30 rounded-full overflow-hidden">
                                          <div 
                                            className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500"
                                            style={{ width: `${sharePercent}%` }}
                                          />
                                        </div>
                                        <span className="text-xs font-medium w-12 text-right">
                                          {sharePercent.toFixed(1)}%
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              });
                            })() : (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">
                                  No commission data available for this period
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
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
          {/* Account Type Filter */}
          <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
            <SelectTrigger className="w-[130px] h-8 bg-muted/30 border-border/50">
              <SelectValue placeholder="Account Type" />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-50">
              <SelectItem value="all">All Accounts</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="margin">Margin</SelectItem>
            </SelectContent>
          </Select>

          {/* Activity Filter */}
          <Select value={activityFilter} onValueChange={setActivityFilter}>
            <SelectTrigger className="w-[140px] h-8 bg-muted/30 border-border/50">
              <SelectValue placeholder="Activity" />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-50">
              <SelectItem value="all">All Accounts</SelectItem>
              <SelectItem value="with_trades">With Trades</SelectItem>
              <SelectItem value="no_trades">No Trades</SelectItem>
            </SelectContent>
          </Select>

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
                  onSelect={handleFromDateChange}
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
            {/* Single Day Mode Button */}
            {dateRangeDays > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSetSingleDay}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                title="Set To = From (single day)"
              >
                1 Day
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs lg:text-sm text-muted-foreground hidden md:inline">
              Period: {format(fromDate, 'dd MMM')} - {format(toDate, 'dd MMM yyyy')} ({dateRangeDays} day{dateRangeDays !== 1 ? 's' : ''})
            </span>
            {isLargeRange && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Large range
              </span>
            )}
          </div>

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
                <div className="pt-4 border-t">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => {
                      setColumns(DEFAULT_COLUMNS);
                      localStorage.removeItem(COLUMNS_STORAGE_KEY);
                      toast.success('Columns reset to defaults');
                    }}
                  >
                    Reset to Defaults
                  </Button>
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

      {/* Error Banner - Enhanced for timeout errors */}
      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="font-medium">
                  {isTimeoutError ? 'Query timed out - date range too large' : 'Failed to load accounting data'}
                </p>
                <p className="text-sm opacity-80 mt-1">
                  {isTimeoutError 
                    ? `The selected ${dateRangeDays}-day range requires too much processing. Try a single day.`
                    : ((queryError as Error)?.message || 'Unknown error')}
                </p>
              </div>
              {isTimeoutError && dateRangeDays > 1 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    handleSetSingleDay();
                    setTimeout(() => refetch(), 100);
                  }}
                  className="shrink-0"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Single Day
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Debug Info */}
      <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-2 items-center">
        <span>Fetched: <strong>{accountingResult?.length ?? 0}</strong> rows</span>
        <span>|</span>
        <span>Range: {format(fromDate, 'MMM dd')} → {format(toDate, 'MMM dd, yyyy')}</span>
        <span>|</span>
        <span>Visible columns: <strong>{visibleColumns.length}</strong></span>
        {visibleColumns.length === 0 && (
          <Button 
            variant="outline" 
            size="sm" 
            className="h-6 text-xs ml-2"
            onClick={() => {
              setColumns(DEFAULT_COLUMNS);
              localStorage.removeItem(COLUMNS_STORAGE_KEY);
              toast.success('Columns reset to defaults');
            }}
          >
            Reset Columns
          </Button>
        )}
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
                            "min-w-[100px] cursor-pointer select-none transition-colors hover:bg-muted/80",
                            column.align === 'right' && "text-right",
                            column.colorClass,
                            draggedColumn === column.id && "opacity-50 bg-primary/20"
                          )}
                          draggable
                          onDragStart={() => handleDragStart(column.id)}
                          onDragOver={(e) => handleDragOver(e, column.id)}
                          onDrop={(e) => handleDrop(e, column.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => handleSort(column.id)}
                        >
                          <div className={cn(
                            "flex items-center gap-1",
                            column.align === 'right' && "justify-end"
                          )}>
                            <GripVertical className="h-3 w-3 text-muted-foreground/50 cursor-grab" />
                            <span>{column.label}</span>
                            {sortColumn === column.id ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-primary" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-primary" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />
                            )}
                          </div>
                        </TableHead>
                      ))}
                      {customFields.map(field => (
                        <TableHead 
                          key={field.id} 
                          className="text-right min-w-[100px] text-primary cursor-pointer hover:bg-muted/80"
                          onClick={() => handleSort(field.id)}
                        >
                          <div className="flex items-center gap-1 justify-end">
                            <span>{field.name}</span>
                            {sortColumn === field.id ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-primary" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-primary" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />
                            )}
                          </div>
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
                    {sortedData.map((row) => (
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
                    {sortedData.length === 0 && !isError && (
                      <TableRow>
                        <TableCell colSpan={visibleColumns.length + customFields.length + 1} className="text-center py-8">
                          <p className="text-muted-foreground">
                            {debouncedSearch 
                              ? `No investors found matching "${debouncedSearch}"` 
                              : `No trades or transactions found for ${format(fromDate, 'MMM dd')} - ${format(toDate, 'MMM dd, yyyy')}`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Try adjusting the date range or clearing your search
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Record Count */}
              <div className="flex items-center justify-between px-6 py-4 border-t">
                <span className="text-sm text-muted-foreground">
                  Showing all {Number(totalCount).toLocaleString()} records
                </span>
              </div>
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
