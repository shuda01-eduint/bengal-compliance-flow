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
import { Search, Download, Wallet, TrendingUp, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText } from "lucide-react";
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
  receivable_payable: number;
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
    // Replace field names with values
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
      'receivable_payable': row.receivable_payable,
      'recv_pay': row.receivable_payable,
      'interest_rate': row.interest_rate,
      'rate': row.interest_rate,
      'brokerage_commission': row.brokerage_commission,
      'commission': row.brokerage_commission,
    };

    Object.entries(fieldMap).forEach(([key, value]) => {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      expression = expression.replace(regex, String(value || 0));
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

  // Fetch client balances
  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['accounting-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('inv_code, investor_name, ledger_balance');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch latest trade date
  const { data: latestTradeDate } = useQuery({
    queryKey: ['accounting-latest-trade-date'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_history')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.trade_date || null;
    },
  });

  // Fetch deposits/withdrawals
  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['accounting-transactions', latestTradeDate],
    queryFn: async () => {
      if (!latestTradeDate) return [];
      const { data, error } = await supabase
        .from('deposits_withdrawals')
        .select('investor_code, transaction_type, amount')
        .eq('transaction_date', latestTradeDate);
      if (error) throw error;
      return data || [];
    },
    enabled: !!latestTradeDate,
  });

  // Fetch trades for net sell calculation
  const { data: trades = [], isLoading: loadingTrades } = useQuery({
    queryKey: ['accounting-trades', latestTradeDate],
    queryFn: async () => {
      if (!latestTradeDate) return [];
      const { data, error } = await supabase
        .from('trade_history')
        .select('client_code, side, value')
        .eq('trade_date', latestTradeDate);
      if (error) throw error;
      return data || [];
    },
    enabled: !!latestTradeDate,
  });

  // Build accounting data
  const accountingData = useMemo(() => {
    const investorMap = new Map(investors.map(i => [i.investor_code, i]));
    const clientMap = new Map(clients.map(c => [c.inv_code, c]));

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

    // Aggregate trades per investor
    const tradeMap: Record<string, { buy: number; sell: number }> = {};
    trades.forEach(t => {
      const code = t.client_code;
      if (!code) return;
      if (!tradeMap[code]) {
        tradeMap[code] = { buy: 0, sell: 0 };
      }
      if (t.side?.toUpperCase() === 'B' || t.side?.toUpperCase() === 'BUY') {
        tradeMap[code].buy += t.value || 0;
      } else if (t.side?.toUpperCase() === 'S' || t.side?.toUpperCase() === 'SELL') {
        tradeMap[code].sell += t.value || 0;
      }
    });

    // Build rows for all investors
    const rows: AccountingRow[] = [];
    
    investors.forEach(inv => {
      const client = clientMap.get(inv.investor_code);
      const tx = txMap[inv.investor_code] || { deposits: 0, withdrawals: 0 };
      const trade = tradeMap[inv.investor_code] || { buy: 0, sell: 0 };
      
      const ledger_balance = client?.ledger_balance || 0;
      const total_deposits = tx.deposits;
      const total_withdrawals = tx.withdrawals;
      const net_sell = trade.sell - trade.buy;
      const adjusted_ledger = ledger_balance + total_deposits - total_withdrawals + net_sell;
      
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
        net_sell,
        adjusted_ledger,
        accrued_interest,
        receivable_payable: net_sell,
      };

      // Calculate custom fields
      customFields.forEach(field => {
        row[field.id] = evaluateFormula(field.formula, row);
      });

      rows.push(row);
    });

    return rows;
  }, [investors, clients, transactions, trades, customFields]);

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
      totalReceivable: accountingData.filter(r => r.receivable_payable > 0).reduce((sum, r) => sum + r.receivable_payable, 0),
      totalPayable: accountingData.filter(r => r.receivable_payable < 0).reduce((sum, r) => sum + Math.abs(r.receivable_payable), 0),
    };
  }, [accountingData]);

  const isLoading = loadingInvestors || loadingClients || loadingTx || loadingTrades;

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
    const baseHeaders = ['Code', 'Name', 'Account Type', 'Interest Rate', 'Commission', 'Ledger Balance', 'Deposits', 'Withdrawals', 'Net Sell', 'Adjusted Ledger', 'Accrued Interest', 'Recv/Pay'];
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
        row.net_sell,
        row.adjusted_ledger,
        row.accrued_interest,
        row.receivable_payable,
      ];
      const customData = customFields.map(f => row[f.id] || 0);
      return [...baseData, ...customData];
    });
    
    const csv = [headers.join(','), ...csvData.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounting_${latestTradeDate || 'data'}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
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
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Receivable</span>
            </div>
            <p className="text-xl font-semibold text-green-400">{formatCurrency(summary.totalReceivable)}</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Payable</span>
            </div>
            <p className="text-xl font-semibold text-amber-400">{formatCurrency(summary.totalPayable)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Range Selection */}
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[130px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(fromDate, 'dd MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
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
                <Button variant="outline" size="sm" className="w-[130px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(toDate, 'dd MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={(d) => d && setToDate(d)}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {latestTradeDate && (
            <span className="text-sm text-muted-foreground">Trade: {latestTradeDate}</span>
          )}
          
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
                      placeholder="e.g., accrued_interest * 30"
                      value={newFieldFormula}
                      onChange={(e) => setNewFieldFormula(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Available: ledger_balance, deposits, withdrawals, net_sell, adjusted_ledger, accrued_interest, interest_rate, commission, ABS()
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
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Interest %</TableHead>
                    <TableHead className="text-right">Commission %</TableHead>
                    <TableHead className="text-right">Ledger Bal</TableHead>
                    <TableHead className="text-right">Deposits</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                    <TableHead className="text-right">Net Sell</TableHead>
                    <TableHead className="text-right">Adj. Ledger</TableHead>
                    <TableHead className="text-right">Accrued Int.</TableHead>
                    <TableHead className="text-right">Recv/Pay</TableHead>
                    {customFields.map(field => (
                      <TableHead key={field.id} className="text-right text-primary">
                        {field.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.slice(0, 100).map((row) => (
                    <TableRow 
                      key={row.investor_code}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedInvestor(row)}
                    >
                      <TableCell className="font-mono">{row.investor_code}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.investor_name}</TableCell>
                      <TableCell>{row.account_type}</TableCell>
                      <TableCell className="text-right">{row.interest_rate.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{row.brokerage_commission.toFixed(2)}</TableCell>
                      <TableCell className={`text-right ${row.ledger_balance < 0 ? 'text-red-400' : ''}`}>
                        {formatCurrency(row.ledger_balance)}
                      </TableCell>
                      <TableCell className="text-right text-green-400">
                        {row.total_deposits > 0 ? formatCurrency(row.total_deposits) : '-'}
                      </TableCell>
                      <TableCell className="text-right text-amber-400">
                        {row.total_withdrawals > 0 ? formatCurrency(row.total_withdrawals) : '-'}
                      </TableCell>
                      <TableCell className={`text-right ${row.net_sell > 0 ? 'text-green-400' : row.net_sell < 0 ? 'text-red-400' : ''}`}>
                        {formatCurrency(row.net_sell)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${row.adjusted_ledger < 0 ? 'text-red-400' : ''}`}>
                        {formatCurrency(row.adjusted_ledger)}
                      </TableCell>
                      <TableCell className="text-right text-orange-400">
                        {row.accrued_interest > 0 ? formatCurrency(row.accrued_interest) : '-'}
                      </TableCell>
                      <TableCell className={`text-right ${row.receivable_payable > 0 ? 'text-green-400' : row.receivable_payable < 0 ? 'text-red-400' : ''}`}>
                        {formatCurrency(row.receivable_payable)}
                      </TableCell>
                      {customFields.map(field => {
                        const value = row[field.id] as number;
                        return (
                          <TableCell key={field.id} className={`text-right ${value < 0 ? 'text-red-400' : value > 0 ? 'text-primary' : ''}`}>
                            {formatCurrency(value)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredData.length > 100 && (
                <p className="text-sm text-muted-foreground mt-4 text-center">
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
