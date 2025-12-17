import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import { Search, Download, Wallet, TrendingUp, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText, ArrowDownToLine, ArrowUpFromLine, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/balance-utils";
import { toast } from "sonner";
import { AccountingReconciliationDialog } from "./AccountingReconciliationDialog";
import { TradeDetailsDialog } from "./TradeDetailsDialog";

export interface AccountingRow {
  investor_code: string;
  investor_name: string;
  account_type: string;
  interest_rate: number;
  brokerage_commission: number;
  ledger_balance: number;
  total_deposits: number;
  total_withdrawals: number;
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
const COLUMNS_STORAGE_KEY = 'accounting-columns-config';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'investor_code', label: 'Code', visible: true, align: 'left' },
  { id: 'investor_name', label: 'Name', visible: true, align: 'left' },
  { id: 'account_type', label: 'Type', visible: true, align: 'left' },
  { id: 'interest_rate', label: 'Int %', visible: true, align: 'right' },
  { id: 'brokerage_commission', label: 'Comm %', visible: true, align: 'right' },
  { id: 'ledger_balance', label: 'Ledger Bal', visible: true, align: 'right' },
  { id: 'total_deposits', label: 'Deposits', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'total_withdrawals', label: 'Withdrawals', visible: true, align: 'right', colorClass: 'text-amber-400' },
  { id: 'gross_buy', label: 'Buy', visible: true, align: 'right', colorClass: 'text-red-400' },
  { id: 'gross_sell', label: 'Sell', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'net_sell', label: 'Net Sell', visible: true, align: 'right' },
  { id: 'adjusted_ledger', label: 'Adj. Ledger', visible: true, align: 'right' },
  { id: 'accrued_interest', label: 'Accrued Int.', visible: true, align: 'right', colorClass: 'text-orange-400' },
  { id: 'brokerage_amount', label: 'Brokerage', visible: true, align: 'right' },
  { id: 'final_balance', label: 'Final Bal', visible: true, align: 'right', colorClass: 'text-blue-400' },
  { id: 'receivable', label: 'Receivable', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'payable', label: 'Payable', visible: true, align: 'right', colorClass: 'text-amber-400' },
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

const AccountingTab = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldFormula, setNewFieldFormula] = useState("");
  const [selectedInvestor, setSelectedInvestor] = useState<AccountingRow | null>(null);
  const [fromDate, setFromDate] = useState<Date>(subDays(new Date(), 2));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [selectedTradeType, setSelectedTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [selectedTradeInvestor, setSelectedTradeInvestor] = useState<AccountingRow | null>(null);

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
    if (saved) {
      try {
        setColumns(JSON.parse(saved));
      } catch {
        console.error('Failed to load columns config');
      }
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

  // Fetch investors with their rates
  const { data: investors = [], isLoading: loadingInvestors } = useQuery({
    queryKey: ['accounting-investors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investors')
        .select('investor_code, investor_name, account_type, interest_rate, brokerage_commission');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch initial ledger balances from balances_raw (admin data)
  const { data: balancesRaw = [], isLoading: loadingBalances } = useQuery({
    queryKey: ['accounting-balances-raw'],
    queryFn: async () => {
      // First get the latest available date in balances_raw
      const { data: dateData, error: dateError } = await supabase
        .from('balances_raw')
        .select('as_of_date')
        .order('as_of_date', { ascending: false })
        .limit(1);
      
      if (dateError) throw dateError;
      const latestBalanceDate = dateData?.[0]?.as_of_date;
      
      if (!latestBalanceDate) return [];
      
      // Fetch aggregated ledger balances per investor for that date
      const { data, error } = await supabase
        .from('balances_raw')
        .select('investor_code, ledger_balance')
        .eq('as_of_date', latestBalanceDate);
      
      if (error) throw error;
      
      // Aggregate ledger_balance per investor (sum across instruments)
      const balanceMap: Record<string, number> = {};
      data?.forEach(row => {
        if (!balanceMap[row.investor_code]) {
          balanceMap[row.investor_code] = 0;
        }
        // Only count ledger_balance once per investor (it's the same across instruments)
        balanceMap[row.investor_code] = row.ledger_balance || 0;
      });
      
      return Object.entries(balanceMap).map(([investor_code, ledger_balance]) => ({
        investor_code,
        ledger_balance,
        as_of_date: latestBalanceDate,
      }));
    },
  });

  // Fetch client names as fallback
  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['accounting-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('inv_code, investor_name');
      if (error) throw error;
      return data || [];
    },
  });

  // Format dates for queries - different formats for different tables
  const fromDateStr = format(fromDate, 'yyyy-MM-dd'); // For deposits_withdrawals (date column)
  const toDateStr = format(toDate, 'yyyy-MM-dd');
  const fromTradeDateStr = format(fromDate, 'yyyyMMdd'); // For trade_history (text column YYYYMMDD)
  const toTradeDateStr = format(toDate, 'yyyyMMdd');

  // Fetch deposits/withdrawals for date range
  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['accounting-transactions', fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits_withdrawals')
        .select('investor_code, transaction_type, amount')
        .gte('transaction_date', fromDateStr)
        .lte('transaction_date', toDateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch aggregated trades for date range using RPC function (avoids 1000-row limit)
  const { data: tradeSums = [], isLoading: loadingTrades } = useQuery({
    queryKey: ['accounting-trade-sums', fromTradeDateStr, toTradeDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_accounting_trade_sums', {
          _from_trade_date: fromTradeDateStr,
          _to_trade_date: toTradeDateStr,
        });
      if (error) throw error;
      return data || [];
    },
  });

  // Build accounting data
  const accountingData = useMemo(() => {
    const investorMap = new Map(investors.map(i => [i.investor_code, i]));
    const clientMap = new Map(clients.map(c => [c.inv_code, c]));
    const balanceMap = new Map(balancesRaw.map(b => [b.investor_code, b.ledger_balance]));

    // Aggregate transactions per investor
    const txMap: Record<string, { deposits: number; withdrawals: number }> = {};
    transactions.forEach(tx => {
      if (!txMap[tx.investor_code]) {
        txMap[tx.investor_code] = { deposits: 0, withdrawals: 0 };
      }
      if (tx.transaction_type === 'Deposit') {
        txMap[tx.investor_code].deposits += tx.amount || 0;
      } else {
        txMap[tx.investor_code].withdrawals += tx.amount || 0;
      }
    });

    // Build trade map from aggregated RPC results
    const tradeMap: Record<string, { buy: number; sell: number }> = {};
    tradeSums.forEach((t: { client_code: string; buy_sum: number; sell_sum: number }) => {
      if (t.client_code) {
        tradeMap[t.client_code] = { 
          buy: Number(t.buy_sum) || 0, 
          sell: Number(t.sell_sum) || 0 
        };
      }
    });

    // Build rows for all investors
    const rows: AccountingRow[] = [];
    
    investors.forEach(inv => {
      const client = clientMap.get(inv.investor_code);
      const tx = txMap[inv.investor_code] || { deposits: 0, withdrawals: 0 };
      const trade = tradeMap[inv.investor_code] || { buy: 0, sell: 0 };
      
      // Get ledger balance from balances_raw (admin data) instead of clients
      const ledger_balance = balanceMap.get(inv.investor_code) || 0;
      const total_deposits = tx.deposits;
      const total_withdrawals = tx.withdrawals;
      const gross_buy = trade.buy;
      const gross_sell = trade.sell;
      const net_sell = gross_sell - gross_buy;
      const adjusted_ledger = ledger_balance + total_deposits - total_withdrawals + net_sell;
      
      // Brokerage amount calculation (brokerage_commission is already stored as decimal e.g. 0.0018 = 0.18%)
      const brokerage_amount = (gross_buy + gross_sell) * (inv.brokerage_commission || 0);
      
      // Calculate final balance: Ledger + Deposits - Withdrawals + Net Sell - Charges
      // If positive: broker owes investor (Receivable)
      // If negative: investor owes broker (Payable)
      const final_balance = ledger_balance + total_deposits - total_withdrawals + net_sell - brokerage_amount;
      const receivable = Math.max(0, final_balance);
      const payable = Math.max(0, -final_balance);
      
      // Calculate accrued interest for margin accounts with negative balance
      let accrued_interest = 0;
      if (inv.account_type?.toLowerCase() === 'margin' && adjusted_ledger < 0) {
        accrued_interest = (inv.interest_rate / 365) * Math.abs(adjusted_ledger) / 100;
      }

      const row: AccountingRow = {
        investor_code: inv.investor_code,
        investor_name: inv.investor_name || client?.investor_name || '',
        account_type: inv.account_type || '',
        interest_rate: inv.interest_rate || 0,
        brokerage_commission: inv.brokerage_commission || 0,
        ledger_balance,
        total_deposits,
        total_withdrawals,
        gross_buy,
        gross_sell,
        net_sell,
        adjusted_ledger,
        accrued_interest,
        receivable,
        payable,
        brokerage_amount,
        final_balance,
      };

      // Calculate custom fields
      customFields.forEach(field => {
        row[field.id] = evaluateFormula(field.formula, row);
      });

      rows.push(row);
    });

    return rows;
  }, [investors, clients, balancesRaw, transactions, tradeSums, customFields]);

  // Filter data
  const filteredData = useMemo(() => {
    if (!searchTerm) return accountingData;
    const term = searchTerm.toLowerCase();
    return accountingData.filter(row => 
      row.investor_code.toLowerCase().includes(term) ||
      row.investor_name.toLowerCase().includes(term)
    );
  }, [accountingData, searchTerm]);

  // Summary calculations
  const summary = useMemo(() => {
    const marginAccounts = accountingData.filter(r => r.account_type?.toLowerCase() === 'margin');
    const marginWithNegative = marginAccounts.filter(r => r.adjusted_ledger < 0);
    
    return {
      totalAccounts: accountingData.length,
      marginAccounts: marginAccounts.length,
      totalMarginLoan: marginWithNegative.reduce((sum, r) => sum + Math.abs(r.adjusted_ledger), 0),
      totalAccruedInterest: marginWithNegative.reduce((sum, r) => sum + r.accrued_interest, 0),
      totalReceivable: accountingData.reduce((sum, r) => sum + r.receivable, 0),
      totalPayable: accountingData.reduce((sum, r) => sum + r.payable, 0),
    };
  }, [accountingData]);

  const isLoading = loadingInvestors || loadingClients || loadingBalances || loadingTx || loadingTrades;

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
    
    const csvData = filteredData.map(row => {
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
        return value.toFixed(2);
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
    <div className="space-y-6 w-full overflow-x-hidden">
      {/* Summary Cards - Sticky */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 -mx-4 px-4 pt-2">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Accounts</span>
              </div>
              <p className="text-xl font-semibold">{summary.totalAccounts.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Percent className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-muted-foreground">Margin Accounts</span>
              </div>
              <p className="text-xl font-semibold text-blue-400">{summary.marginAccounts.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="h-4 w-4 text-red-400" />
                <span className="text-xs text-muted-foreground">Margin Loan</span>
              </div>
              <p className="text-xl font-semibold text-red-400">{formatCurrency(summary.totalMarginLoan)}</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-orange-400" />
                <span className="text-xs text-muted-foreground">Accrued Interest</span>
              </div>
              <p className="text-xl font-semibold text-orange-400">{formatCurrency(summary.totalAccruedInterest)}</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDownToLine className="h-4 w-4 text-green-400" />
                <span className="text-xs text-muted-foreground">Receivable</span>
              </div>
              <p className="text-xl font-semibold text-green-400">{formatCurrency(summary.totalReceivable)}</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpFromLine className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-muted-foreground">Payable</span>
              </div>
              <p className="text-xl font-semibold text-amber-400">{formatCurrency(summary.totalPayable)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4">
        {/* Search Row */}
        <div className="relative w-full max-w-lg group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/5 rounded-lg blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search investor by code or name..."
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
          {searchTerm && (
            <span className="absolute -bottom-5 left-0 text-xs text-muted-foreground">
              {filteredData.length} result{filteredData.length !== 1 ? 's' : ''} found
            </span>
          )}
        </div>

        {/* Actions Row */}
        <div className="flex flex-wrap items-center gap-3">
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

          <span className="text-sm text-muted-foreground hidden sm:inline">
            Period: {format(fromDate, 'dd MMM')} - {format(toDate, 'dd MMM yyyy')}
          </span>

          <div className="flex items-center gap-2 ml-auto">
            <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Custom Fields
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Manage Custom Fields</DialogTitle>
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
                <Button variant="outline" size="sm">
                  <Eye className="h-4 w-4 mr-2" />
                  Columns
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Configure Columns</DialogTitle>
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

            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
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
                    {filteredData.slice(0, 100).map((row) => (
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
                                  "cursor-pointer hover:underline hover:bg-primary/10 transition-colors"
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
                            <TableCell key={column.id} className={getCellClassName(row, column)}>
                              {getCellValue(row, column.id)}
                            </TableCell>
                          );
                        })}
                        {customFields.map(field => {
                          const value = row[field.id] as number;
                          return (
                            <TableCell key={field.id} className={cn("text-right", value < 0 ? 'text-red-400' : value > 0 ? 'text-primary' : '')}>
                              {formatCurrency(value)}
                            </TableCell>
                          );
                        })}
                        <TableCell className="w-[40px]"></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filteredData.length > 100 && (
                <p className="text-sm text-muted-foreground mt-4 text-center p-4">
                  Showing 100 of {filteredData.length} records
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation Dialog */}
      <AccountingReconciliationDialog
        investor={selectedInvestor}
        onClose={() => setSelectedInvestor(null)}
        fromDate={fromDate}
        toDate={toDate}
      />

      {/* Trade Details Dialog */}
      {selectedTradeInvestor && (
        <TradeDetailsDialog
          open={tradeDetailsOpen}
          onOpenChange={setTradeDetailsOpen}
          investorCode={selectedTradeInvestor.investor_code}
          investorName={selectedTradeInvestor.investor_name}
          tradeType={selectedTradeType}
          fromDate={fromDate}
          toDate={toDate}
        />
      )}
    </div>
  );
};

export default AccountingTab;
