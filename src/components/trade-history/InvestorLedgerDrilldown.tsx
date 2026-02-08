import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format, subDays, parseISO } from "date-fns";
import { CalendarIcon, Download, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/balance-utils";
import { rpcWithRetry, formatRpcError } from "@/lib/rpc-utils";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface InvestorLedgerDrilldownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorCode: string;
  investorName: string;
  initialDate: Date;
}

interface LedgerTransaction {
  txn_date: string;
  entry_type: string;
  scrip_name: string | null;
  qty: number | null;
  rate: number | null;
  trade_value: number | null;
  commission: number | null;
  debit: number;
  credit: number;
  running_balance: number;
}

interface DailyBalance {
  balance_date: string;
  closing_balance: number;
}

// Normalize a date to local midnight
const normalizeToLocalDate = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const InvestorLedgerDrilldown = ({
  open,
  onOpenChange,
  investorCode,
  investorName,
  initialDate,
}: InvestorLedgerDrilldownProps) => {
  const [fromDate, setFromDate] = useState<Date>(subDays(initialDate, 30));
  const [toDate, setToDate] = useState<Date>(initialDate);

  const fromDateStr = format(fromDate, 'yyyy-MM-dd');
  const toDateStr = format(toDate, 'yyyy-MM-dd');

  // Fetch investor ledger transactions
  const { data: transactions, isLoading: loadingTxns, isError, error } = useQuery({
    queryKey: ['investor-ledger', investorCode, fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await rpcWithRetry<LedgerTransaction[]>(
        'get_investor_ledger',
        {
          _investor_code: investorCode,
          _from_date: fromDateStr,
          _to_date: toDateStr
        }
      );
      
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!investorCode,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch daily balances for chart
  const { data: dailyBalances, isLoading: loadingBalances } = useQuery({
    queryKey: ['investor-daily-balances', investorCode, fromDateStr, toDateStr],
    queryFn: async () => {
      const { data, error } = await rpcWithRetry<DailyBalance[]>(
        'get_investor_daily_balances',
        {
          _investor_code: investorCode,
          _from_date: fromDateStr,
          _to_date: toDateStr
        }
      );
      
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!investorCode,
    staleTime: 5 * 60 * 1000,
  });

  // Calculate summary stats
  const summary = useMemo(() => {
    if (!transactions?.length) return null;
    
    let totalDebit = 0;
    let totalCredit = 0;
    
    transactions.forEach(txn => {
      totalDebit += txn.debit || 0;
      totalCredit += txn.credit || 0;
    });
    
    const lastBalance = transactions[transactions.length - 1]?.running_balance || 0;
    
    return { totalDebit, totalCredit, lastBalance };
  }, [transactions]);

  // Format chart data
  const chartData = useMemo(() => {
    if (!dailyBalances?.length) return [];
    return dailyBalances.map(d => ({
      date: format(parseISO(d.balance_date), 'MMM dd'),
      balance: Number(d.closing_balance),
    }));
  }, [dailyBalances]);

  const handleExportCSV = () => {
    if (!transactions?.length) return;
    
    const headers = [
      'Date', 'Type', 'Scrip', 'Qty', 'Rate', 'Trade Value',
      'Commission', 'Debit', 'Credit', 'Running Balance'
    ];
    
    const rows = transactions.map(txn => [
      txn.txn_date,
      txn.entry_type,
      txn.scrip_name || '',
      txn.qty || '',
      txn.rate || '',
      txn.trade_value || '',
      txn.commission || '',
      txn.debit,
      txn.credit,
      txn.running_balance
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${investorCode}-${fromDateStr}-${toDateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getEntryTypeColor = (type: string) => {
    switch (type) {
      case 'DEPOSIT':
        return 'text-green-400';
      case 'WITHDRAWAL':
        return 'text-amber-400';
      case 'BUY':
        return 'text-red-400';
      case 'SELL':
        return 'text-green-400';
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-primary">{investorCode}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span>{investorName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* Date Range Picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[150px] justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(fromDate, "MMM dd, yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={normalizeToLocalDate(fromDate)}
                  onSelect={(date) => date && setFromDate(normalizeToLocalDate(date))}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground">to</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[150px] justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(toDate, "MMM dd, yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={normalizeToLocalDate(toDate)}
                  onSelect={(date) => date && setToDate(normalizeToLocalDate(date))}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!transactions?.length}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent border-red-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Debit</p>
                      <p className="text-lg font-bold text-red-400">
                        {formatCurrency(summary.totalDebit)}
                      </p>
                    </div>
                    <TrendingDown className="h-6 w-6 text-red-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-green-500/20 via-green-500/10 to-transparent border-green-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Credit</p>
                      <p className="text-lg font-bold text-green-400">
                        {formatCurrency(summary.totalCredit)}
                      </p>
                    </div>
                    <TrendingUp className="h-6 w-6 text-green-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent border-blue-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Last Balance</p>
                      <p className={cn(
                        "text-lg font-bold",
                        summary.lastBalance >= 0 ? "text-blue-400" : "text-amber-400"
                      )}>
                        {formatCurrency(summary.lastBalance)}
                      </p>
                    </div>
                    <TrendingUp className="h-6 w-6 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Daily Balance Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium mb-4">Daily Balance Trend</p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                      />
                      <YAxis 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                        tickFormatter={(v) => formatCurrency(v)}
                        width={80}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(value: number) => [formatCurrency(value), 'Balance']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="balance" 
                        stroke="hsl(var(--primary))" 
                        fill="url(#balanceGradient)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transactions Table */}
          <Card>
            <CardContent className="p-0">
              {loadingTxns ? (
                <div className="p-4 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : isError ? (
                <div className="p-4 text-center text-destructive">
                  {formatRpcError(error as Error)}
                </div>
              ) : !transactions?.length ? (
                <div className="p-6 text-center text-muted-foreground">
                  No transactions found for the selected period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Scrip</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right text-red-400">Debit</TableHead>
                        <TableHead className="text-right text-green-400">Credit</TableHead>
                        <TableHead className="text-right text-blue-400">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((txn, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/50">
                          <TableCell>{format(parseISO(txn.txn_date), 'MMM dd, yyyy')}</TableCell>
                          <TableCell className={getEntryTypeColor(txn.entry_type)}>
                            {txn.entry_type}
                          </TableCell>
                          <TableCell>{txn.scrip_name || '-'}</TableCell>
                          <TableCell className="text-right font-mono">
                            {txn.qty?.toLocaleString() || '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {txn.rate ? formatCurrency(txn.rate) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {txn.trade_value ? formatCurrency(txn.trade_value) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-purple-400">
                            {txn.commission ? formatCurrency(txn.commission) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-400">
                            {txn.debit > 0 ? formatCurrency(txn.debit) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-400">
                            {txn.credit > 0 ? formatCurrency(txn.credit) : '-'}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-mono",
                            txn.running_balance >= 0 ? "text-blue-400" : "text-amber-400"
                          )}>
                            {formatCurrency(txn.running_balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};
