import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, addDays, differenceInDays } from "date-fns";
import { CalendarIcon, Download, ArrowRight, TrendingUp, TrendingDown, Minus, User, Wallet, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/balance-utils";

interface AccountingRow {
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
}

interface AccountingReconciliationDialogProps {
  investor: AccountingRow | null;
  onClose: () => void;
  fromDate: Date;
  toDate: Date;
}

interface HoldingComparison {
  instrument: string;
  category: string | null;
  before_qty: number;
  after_qty: number;
  before_cost: number;
  after_cost: number;
  before_mv: number;
  after_mv: number;
  change: 'new' | 'closed' | 'increased' | 'decreased' | 'unchanged';
}

interface TradeActivity {
  trade_date: string;
  security_code: string;
  side: string;
  quantity: number;
  value: number;
  settlement_date: string;
  is_settled: boolean;
}

interface BalanceChange {
  field: string;
  opening: number;
  closing: number;
  change: number;
  explanation: string;
}

export function AccountingReconciliationDialog({
  investor,
  onClose,
  fromDate,
  toDate,
}: AccountingReconciliationDialogProps) {
  const [selectedFromDate, setSelectedFromDate] = useState<Date>(fromDate);
  const [selectedToDate, setSelectedToDate] = useState<Date>(toDate);

  const fromDateStr = format(selectedFromDate, 'yyyy-MM-dd');
  const toDateStr = format(selectedToDate, 'yyyy-MM-dd');
  const daysDiff = differenceInDays(selectedToDate, selectedFromDate);

  // Fetch investor details
  const { data: investorDetails } = useQuery({
    queryKey: ['reconciliation-investor', investor?.investor_code],
    queryFn: async () => {
      if (!investor?.investor_code) return null;
      const { data, error } = await supabase
        .from('investors')
        .select('*')
        .eq('investor_code', investor.investor_code)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!investor?.investor_code,
  });

  // Fetch balances for both dates
  const { data: balancesBefore = [], isLoading: loadingBefore } = useQuery({
    queryKey: ['reconciliation-balances-before', investor?.investor_code, fromDateStr],
    queryFn: async () => {
      if (!investor?.investor_code) return [];
      const { data, error } = await supabase
        .from('balances_raw')
        .select('*')
        .eq('investor_code', investor.investor_code)
        .eq('as_of_date', fromDateStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor?.investor_code,
  });

  const { data: balancesAfter = [], isLoading: loadingAfter } = useQuery({
    queryKey: ['reconciliation-balances-after', investor?.investor_code, toDateStr],
    queryFn: async () => {
      if (!investor?.investor_code) return [];
      const { data, error } = await supabase
        .from('balances_raw')
        .select('*')
        .eq('investor_code', investor.investor_code)
        .eq('as_of_date', toDateStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor?.investor_code,
  });

  // Fetch trades between dates
  const { data: trades = [], isLoading: loadingTrades } = useQuery({
    queryKey: ['reconciliation-trades', investor?.investor_code, fromDateStr, toDateStr],
    queryFn: async () => {
      if (!investor?.investor_code) return [];
      const { data, error } = await supabase
        .from('trade_history')
        .select('trade_date, security_code, side, quantity, value, category')
        .eq('client_code', investor.investor_code)
        .gte('trade_date', fromDateStr)
        .lte('trade_date', toDateStr)
        .order('trade_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor?.investor_code,
  });

  // Fetch transactions between dates
  const { data: transactions = [] } = useQuery({
    queryKey: ['reconciliation-transactions', investor?.investor_code, fromDateStr, toDateStr],
    queryFn: async () => {
      if (!investor?.investor_code) return [];
      const { data, error } = await supabase
        .from('deposits_withdrawals')
        .select('*')
        .eq('investor_code', investor.investor_code)
        .gte('transaction_date', fromDateStr)
        .lte('transaction_date', toDateStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor?.investor_code,
  });

  // Holdings comparison
  const holdingsComparison = useMemo((): HoldingComparison[] => {
    const beforeMap = new Map(balancesBefore.map(b => [b.instrument, b]));
    const afterMap = new Map(balancesAfter.map(b => [b.instrument, b]));
    const allInstruments = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    return Array.from(allInstruments).filter(i => i).map(instrument => {
      const before = beforeMap.get(instrument);
      const after = afterMap.get(instrument);
      
      const before_qty = before?.total_stock || 0;
      const after_qty = after?.total_stock || 0;
      
      let change: HoldingComparison['change'] = 'unchanged';
      if (!before && after) change = 'new';
      else if (before && !after) change = 'closed';
      else if (after_qty > before_qty) change = 'increased';
      else if (after_qty < before_qty) change = 'decreased';

      return {
        instrument: instrument || '',
        category: after?.instrument || before?.instrument || null,
        before_qty,
        after_qty,
        before_cost: before?.total_cost || 0,
        after_cost: after?.total_cost || 0,
        before_mv: before?.total_mv || 0,
        after_mv: after?.total_mv || 0,
        change,
      };
    }).sort((a, b) => {
      const order = { new: 0, closed: 1, increased: 2, decreased: 3, unchanged: 4 };
      return order[a.change] - order[b.change];
    });
  }, [balancesBefore, balancesAfter]);

  // Aggregate trade activity
  const tradeActivity = useMemo((): TradeActivity[] => {
    const grouped: Record<string, TradeActivity> = {};
    
    trades.forEach(t => {
      const key = `${t.trade_date}-${t.security_code}-${t.side}`;
      if (!grouped[key]) {
        const isZCategory = t.category?.toUpperCase() === 'Z';
        const settlementDays = isZCategory ? 3 : 2;
        const tradeDate = new Date(t.trade_date || '');
        const settlementDate = addDays(tradeDate, settlementDays);
        
        grouped[key] = {
          trade_date: t.trade_date || '',
          security_code: t.security_code || '',
          side: t.side || '',
          quantity: 0,
          value: 0,
          settlement_date: format(settlementDate, 'yyyy-MM-dd'),
          is_settled: settlementDate <= selectedToDate,
        };
      }
      grouped[key].quantity += t.quantity || 0;
      grouped[key].value += t.value || 0;
    });

    return Object.values(grouped).sort((a, b) => 
      a.trade_date.localeCompare(b.trade_date) || a.security_code.localeCompare(b.security_code)
    );
  }, [trades, selectedToDate]);

  // Calculate summary totals
  const summaryBefore = useMemo(() => {
    return {
      ledger_balance: balancesBefore[0]?.ledger_balance || 0,
      matured_balance: balancesBefore[0]?.matured_balance || 0,
      receivable_sale: balancesBefore.reduce((sum, b) => sum + (b.receivable_sale || 0), 0),
      total_cost: balancesBefore.reduce((sum, b) => sum + (b.total_cost || 0), 0),
      total_mv: balancesBefore.reduce((sum, b) => sum + (b.total_mv || 0), 0),
    };
  }, [balancesBefore]);

  const summaryAfter = useMemo(() => {
    return {
      ledger_balance: balancesAfter[0]?.ledger_balance || 0,
      matured_balance: balancesAfter[0]?.matured_balance || 0,
      receivable_sale: balancesAfter.reduce((sum, b) => sum + (b.receivable_sale || 0), 0),
      total_cost: balancesAfter.reduce((sum, b) => sum + (b.total_cost || 0), 0),
      total_mv: balancesAfter.reduce((sum, b) => sum + (b.total_mv || 0), 0),
    };
  }, [balancesAfter]);

  // Transaction totals
  const txTotals = useMemo(() => {
    return transactions.reduce((acc, tx) => {
      if (tx.transaction_type === 'Deposit') {
        acc.deposits += tx.amount || 0;
      } else {
        acc.withdrawals += tx.amount || 0;
      }
      return acc;
    }, { deposits: 0, withdrawals: 0 });
  }, [transactions]);

  // Trade totals
  const tradeTotals = useMemo(() => {
    return tradeActivity.reduce((acc, t) => {
      if (t.side?.toUpperCase() === 'B' || t.side?.toUpperCase() === 'BUY') {
        acc.buy += t.value;
        if (t.is_settled) acc.buySettled += t.value;
      } else {
        acc.sell += t.value;
        if (t.is_settled) acc.sellSettled += t.value;
      }
      return acc;
    }, { buy: 0, sell: 0, buySettled: 0, sellSettled: 0 });
  }, [tradeActivity]);

  // Calculate accrued interest
  const accruedInterest = useMemo(() => {
    if (!investorDetails?.account_type?.toLowerCase().includes('margin')) return 0;
    if (summaryBefore.matured_balance >= 0) return 0;
    const rate = investorDetails?.interest_rate || 16;
    return (rate / 365) * daysDiff * Math.abs(summaryBefore.matured_balance) / 100;
  }, [investorDetails, summaryBefore.matured_balance, daysDiff]);

  // Balance changes explanation
  const balanceChanges = useMemo((): BalanceChange[] => {
    const settledReceivable = summaryBefore.receivable_sale - summaryAfter.receivable_sale;
    
    return [
      {
        field: 'Ledger Balance',
        opening: summaryBefore.ledger_balance,
        closing: summaryAfter.ledger_balance,
        change: summaryAfter.ledger_balance - summaryBefore.ledger_balance,
        explanation: `Net trades + deposits - withdrawals`,
      },
      {
        field: 'Matured Balance',
        opening: summaryBefore.matured_balance,
        closing: summaryAfter.matured_balance,
        change: summaryAfter.matured_balance - summaryBefore.matured_balance,
        explanation: 'After settlement adjustments',
      },
      {
        field: 'Receivable Sales',
        opening: summaryBefore.receivable_sale,
        closing: summaryAfter.receivable_sale,
        change: summaryAfter.receivable_sale - summaryBefore.receivable_sale,
        explanation: settledReceivable > 0 ? `${formatCurrency(settledReceivable)} settled` : 'Pending settlements',
      },
      {
        field: 'Accrued Interest',
        opening: 0,
        closing: accruedInterest,
        change: accruedInterest,
        explanation: `${investorDetails?.interest_rate || 16}%/365 × ${daysDiff} days`,
      },
      {
        field: 'Market Value',
        opening: summaryBefore.total_mv,
        closing: summaryAfter.total_mv,
        change: summaryAfter.total_mv - summaryBefore.total_mv,
        explanation: 'Price × Quantity changes',
      },
      {
        field: 'Total Cost',
        opening: summaryBefore.total_cost,
        closing: summaryAfter.total_cost,
        change: summaryAfter.total_cost - summaryBefore.total_cost,
        explanation: 'New purchases - sales at cost',
      },
    ];
  }, [summaryBefore, summaryAfter, accruedInterest, daysDiff, investorDetails]);

  // Export reconciliation
  const handleExport = () => {
    const lines = [
      `Reconciliation Report: ${investor?.investor_code}`,
      `Investor: ${investor?.investor_name}`,
      `Period: ${fromDateStr} to ${toDateStr}`,
      '',
      'ACCOUNT STATUS CHANGES',
      'Field,Opening,Closing,Change,Explanation',
      ...balanceChanges.map(b => `${b.field},${b.opening},${b.closing},${b.change},"${b.explanation}"`),
      '',
      'HOLDINGS COMPARISON',
      'Instrument,Before Qty,After Qty,Before Cost,After Cost,Change',
      ...holdingsComparison.map(h => `${h.instrument},${h.before_qty},${h.after_qty},${h.before_cost},${h.after_cost},${h.change}`),
      '',
      'TRADE ACTIVITY',
      'Date,Security,Side,Quantity,Value,Settlement Date,Settled',
      ...tradeActivity.map(t => `${t.trade_date},${t.security_code},${t.side},${t.quantity},${t.value},${t.settlement_date},${t.is_settled}`),
    ];
    
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation_${investor?.investor_code}_${fromDateStr}_${toDateStr}.csv`;
    a.click();
  };

  const isLoading = loadingBefore || loadingAfter || loadingTrades;

  if (!investor) return null;

  const ChangeIcon = ({ value }: { value: number }) => {
    if (value > 0) return <TrendingUp className="h-4 w-4 text-green-400" />;
    if (value < 0) return <TrendingDown className="h-4 w-4 text-red-400" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Dialog open={!!investor} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm sm:text-base">Reconciliation: {investor.investor_code}</span>
              <Badge variant={investor.account_type?.toLowerCase() === 'margin' ? 'destructive' : 'default'}>
                {investor.account_type || 'Cash'}
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Date Selection */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 sm:p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">From:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[100px] sm:w-[130px] text-xs sm:text-sm">
                  <CalendarIcon className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  {format(selectedFromDate, 'dd MMM yy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-background border">
                <Calendar
                  mode="single"
                  selected={selectedFromDate}
                  onSelect={(d) => d && setSelectedFromDate(d)}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">To:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-[100px] sm:w-[130px] text-xs sm:text-sm">
                  <CalendarIcon className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  {format(selectedToDate, 'dd MMM yy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-background border">
                <Calendar
                  mode="single"
                  selected={selectedToDate}
                  onSelect={(d) => d && setSelectedToDate(d)}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <Badge variant="secondary" className="text-xs">{daysDiff} days</Badge>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="summary" className="space-y-4">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="holdings">Holdings</TabsTrigger>
              <TabsTrigger value="trades">Trades</TabsTrigger>
              <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
            </TabsList>

            {/* Summary Tab */}
            <TabsContent value="summary" className="space-y-4">
              {/* Account Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Account Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Name</span>
                      <p className="font-medium">{investor.investor_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">BO ID</span>
                      <p className="font-medium">{investorDetails?.bo_id || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Interest Rate</span>
                      <p className="font-medium">{investor.interest_rate}%</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Brokerage</span>
                      <p className="font-medium">{investor.brokerage_commission}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Account Status Reconciliation */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Account Status Reconciliation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead className="text-right">Opening ({format(selectedFromDate, 'dd MMM')})</TableHead>
                        <TableHead className="text-right">Closing ({format(selectedToDate, 'dd MMM')})</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead>Explanation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceChanges.map((row) => (
                        <TableRow key={row.field}>
                          <TableCell className="font-medium">{row.field}</TableCell>
                          <TableCell className={cn("text-right", row.opening < 0 && "text-red-400")}>
                            {formatCurrency(row.opening)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.closing < 0 && "text-red-400")}>
                            {formatCurrency(row.closing)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <ChangeIcon value={row.change} />
                              <span className={cn(
                                row.change > 0 && "text-green-400",
                                row.change < 0 && "text-red-400"
                              )}>
                                {formatCurrency(Math.abs(row.change))}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{row.explanation}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Holdings Tab */}
            <TabsContent value="holdings">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Holdings Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Instrument</TableHead>
                        <TableHead className="text-right">Before Qty</TableHead>
                        <TableHead className="text-right">After Qty</TableHead>
                        <TableHead className="text-right">Before Cost</TableHead>
                        <TableHead className="text-right">After Cost</TableHead>
                        <TableHead className="text-right">Before MV</TableHead>
                        <TableHead className="text-right">After MV</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdingsComparison.map((h) => (
                        <TableRow key={h.instrument} className={cn(
                          h.change === 'new' && 'bg-green-500/10',
                          h.change === 'closed' && 'bg-red-500/10'
                        )}>
                          <TableCell className="font-mono">{h.instrument}</TableCell>
                          <TableCell className="text-right">{h.before_qty.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{h.after_qty.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{formatCurrency(h.before_cost)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(h.after_cost)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(h.before_mv)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(h.after_mv)}</TableCell>
                          <TableCell>
                            <Badge variant={
                              h.change === 'new' ? 'default' :
                              h.change === 'closed' ? 'destructive' :
                              h.change === 'increased' ? 'default' :
                              h.change === 'decreased' ? 'secondary' : 'outline'
                            }>
                              {h.change}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {holdingsComparison.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            No holdings data available for selected dates
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Trades Tab */}
            <TabsContent value="trades">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Trade Activity ({tradeActivity.length} trades)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="p-3 bg-green-500/10 rounded-lg">
                      <span className="text-xs text-muted-foreground">Total Buy</span>
                      <p className="text-lg font-semibold text-green-400">{formatCurrency(tradeTotals.buy)}</p>
                    </div>
                    <div className="p-3 bg-red-500/10 rounded-lg">
                      <span className="text-xs text-muted-foreground">Total Sell</span>
                      <p className="text-lg font-semibold text-red-400">{formatCurrency(tradeTotals.sell)}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <span className="text-xs text-muted-foreground">Net Position</span>
                      <p className={cn("text-lg font-semibold", 
                        tradeTotals.sell - tradeTotals.buy > 0 ? 'text-green-400' : 'text-red-400'
                      )}>
                        {formatCurrency(tradeTotals.sell - tradeTotals.buy)}
                      </p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <span className="text-xs text-muted-foreground">Settled</span>
                      <p className="text-lg font-semibold">
                        {formatCurrency(tradeTotals.sellSettled - tradeTotals.buySettled)}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Security</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Settlement</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tradeActivity.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell>{t.trade_date}</TableCell>
                          <TableCell className="font-mono">{t.security_code}</TableCell>
                          <TableCell>
                            <Badge variant={t.side === 'B' || t.side === 'BUY' ? 'default' : 'destructive'}>
                              {t.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{t.quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.value)}</TableCell>
                          <TableCell className="text-muted-foreground">{t.settlement_date}</TableCell>
                          <TableCell>
                            <Badge variant={t.is_settled ? 'default' : 'outline'}>
                              {t.is_settled ? 'Settled' : 'Pending'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {tradeActivity.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No trades in selected period
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Waterfall Tab */}
            <TabsContent value="waterfall">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Balance Movement Waterfall</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                      <span className="font-medium">Opening Ledger Balance</span>
                      <span className={cn("font-semibold", summaryBefore.ledger_balance < 0 && "text-red-400")}>
                        {formatCurrency(summaryBefore.ledger_balance)}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-green-500 bg-green-500/10 rounded-r-lg">
                      <span>+ Deposits</span>
                      <span className="text-green-400">{formatCurrency(txTotals.deposits)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-red-500 bg-red-500/10 rounded-r-lg">
                      <span>- Withdrawals</span>
                      <span className="text-red-400">{formatCurrency(txTotals.withdrawals)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-green-500 bg-green-500/10 rounded-r-lg">
                      <span>+ Sell Proceeds</span>
                      <span className="text-green-400">{formatCurrency(tradeTotals.sell)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-red-500 bg-red-500/10 rounded-r-lg">
                      <span>- Buy Payments</span>
                      <span className="text-red-400">{formatCurrency(tradeTotals.buy)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-amber-500 bg-amber-500/10 rounded-r-lg">
                      <span>- Brokerage (estimated)</span>
                      <span className="text-amber-400">
                        {formatCurrency((tradeTotals.buy + tradeTotals.sell) * (investor.brokerage_commission || 0.25) / 100)}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 border-l-4 border-blue-500 bg-blue-500/10 rounded-r-lg">
                      <span>+ Receivables Settled</span>
                      <span className="text-blue-400">
                        {formatCurrency(Math.max(0, summaryBefore.receivable_sale - summaryAfter.receivable_sale))}
                      </span>
                    </div>

                    <Separator />
                    
                    <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg">
                      <span className="font-medium">= Closing Ledger Balance</span>
                      <span className={cn("font-semibold text-lg", summaryAfter.ledger_balance < 0 && "text-red-400")}>
                        {formatCurrency(summaryAfter.ledger_balance)}
                      </span>
                    </div>

                    {accruedInterest > 0 && (
                      <div className="flex justify-between items-center p-3 border-l-4 border-orange-500 bg-orange-500/10 rounded-r-lg">
                        <span>+ Accrued Interest ({daysDiff} days @ {investor.interest_rate}%)</span>
                        <span className="text-orange-400">{formatCurrency(accruedInterest)}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
