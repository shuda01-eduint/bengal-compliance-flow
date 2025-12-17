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
import { Search, Download, Wallet, TrendingUp, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { formatCurrency } from "@/lib/balance-utils";
import { toast } from "sonner";
import { AccountingReconciliationDialog } from "./AccountingReconciliationDialog";

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
  gross_buy: number;
  gross_sell: number;
  [key: string]: string | number;
}

interface CustomField {
  id: string;
  name: string;
  formula: string;
}

const STORAGE_KEY = 'accounting-custom-fields';

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
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldFormula, setNewFieldFormula] = useState("");
  const [selectedInvestor, setSelectedInvestor] = useState<AccountingRow | null>(null);
  const [fromDate, setFromDate] = useState<Date>(subDays(new Date(), 2));
  const [toDate, setToDate] = useState<Date>(new Date());

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

  // Save custom fields to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customFields));
  }, [customFields]);

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
      
      // Brokerage amount calculation
      const brokerage_amount = (gross_buy + gross_sell) * (inv.brokerage_commission || 0) / 100;
      
      // Calculate receivable (from broker - when net_sell > 0) and payable (to broker - when net_sell < 0)
      const receivable = Math.max(0, net_sell);
      const payable = Math.max(0, -net_sell);
      
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Date Range Selection */}
          <div className="flex items-center gap-1 sm:gap-2 p-2 bg-muted/30 rounded-lg flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[110px] sm:w-[130px] text-xs sm:text-sm">
                  <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
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
            <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[110px] sm:w-[130px] text-xs sm:text-sm">
                  <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
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

          <span className="text-sm text-muted-foreground">
            Period: {format(fromDate, 'dd MMM')} - {format(toDate, 'dd MMM yyyy')}
          </span>
          
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

          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
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
            <div className="relative">
              {/* Frozen columns wrapper */}
              <div className="flex">
                {/* Frozen left columns */}
                <div className="flex-shrink-0 border-r border-border bg-background z-10 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.15)]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-[100px] min-w-[100px] bg-muted/50">Code</TableHead>
                        <TableHead className="w-[180px] min-w-[180px] bg-muted/50">Name</TableHead>
                        <TableHead className="w-[80px] min-w-[80px] bg-muted/50">Type</TableHead>
                        <TableHead className="w-[80px] min-w-[80px] text-right bg-muted/50">Int %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.slice(0, 100).map((row) => (
                        <TableRow 
                          key={row.investor_code}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedInvestor(row)}
                        >
                          <TableCell className="font-mono w-[100px]">{row.investor_code}</TableCell>
                          <TableCell className="w-[180px] truncate">{row.investor_name}</TableCell>
                          <TableCell className="w-[80px]">{row.account_type}</TableCell>
                          <TableCell className="w-[80px] text-right">{row.interest_rate.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Scrollable right columns */}
                <div className="overflow-x-auto flex-1">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-right min-w-[90px]">Comm %</TableHead>
                        <TableHead className="text-right min-w-[110px]">Ledger Bal</TableHead>
                        <TableHead className="text-right min-w-[100px]">Deposits</TableHead>
                        <TableHead className="text-right min-w-[100px]">Withdrawals</TableHead>
                        <TableHead className="text-right min-w-[100px]">Buy</TableHead>
                        <TableHead className="text-right min-w-[100px]">Sell</TableHead>
                        <TableHead className="text-right min-w-[100px]">Net Sell</TableHead>
                        <TableHead className="text-right min-w-[110px]">Adj. Ledger</TableHead>
                        <TableHead className="text-right min-w-[100px]">Accrued Int.</TableHead>
                        <TableHead className="text-right min-w-[120px] text-green-400">Receivable</TableHead>
                        <TableHead className="text-right min-w-[120px] text-amber-400">Payable</TableHead>
                        <TableHead className="text-right min-w-[100px]">Brokerage</TableHead>
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
                          <TableCell className="text-right">{row.brokerage_commission.toFixed(2)}</TableCell>
                          <TableCell className={cn("text-right", row.ledger_balance < 0 && "text-red-400")}>
                            {formatCurrency(row.ledger_balance)}
                          </TableCell>
                          <TableCell className="text-right text-green-400">
                            {row.total_deposits > 0 ? formatCurrency(row.total_deposits) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-amber-400">
                            {row.total_withdrawals > 0 ? formatCurrency(row.total_withdrawals) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-red-400">
                            {row.gross_buy > 0 ? formatCurrency(row.gross_buy) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-green-400">
                            {row.gross_sell > 0 ? formatCurrency(row.gross_sell) : '-'}
                          </TableCell>
                          <TableCell className={cn("text-right", row.net_sell > 0 ? 'text-green-400' : row.net_sell < 0 ? 'text-red-400' : '')}>
                            {formatCurrency(row.net_sell)}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", row.adjusted_ledger < 0 && "text-red-400")}>
                            {formatCurrency(row.adjusted_ledger)}
                          </TableCell>
                          <TableCell className="text-right text-orange-400">
                            {row.accrued_interest > 0 ? formatCurrency(row.accrued_interest) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-green-400 font-medium">
                            {row.receivable > 0 ? formatCurrency(row.receivable) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-amber-400 font-medium">
                            {row.payable > 0 ? formatCurrency(row.payable) : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.brokerage_amount > 0 ? formatCurrency(row.brokerage_amount) : '-'}
                          </TableCell>
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
    </div>
  );
};

export default AccountingTab;
