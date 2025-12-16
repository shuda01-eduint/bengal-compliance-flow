import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Search, Calendar as CalendarIcon, FileText, Download } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface LedgerTransaction {
  date: string;
  operation: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
  details: string;
  quantity: number | null;
  rate: number | null;
  debit: number;
  credit: number;
  balance: number;
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value: number | null): string => {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 4,
    maximumFractionDigits: 4,
  }).format(value);
};

const InvestorLedgerPage = () => {
  const [investorCode, setInvestorCode] = useState("");
  const [searchedCode, setSearchedCode] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  // Fetch investor info
  const { data: investor, isLoading: investorLoading } = useQuery({
    queryKey: ['investor-ledger-info', searchedCode],
    queryFn: async () => {
      if (!searchedCode) return null;
      const { data, error } = await supabase
        .from('investors')
        .select('*')
        .eq('investor_code', searchedCode)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!searchedCode,
  });

  // Fetch client info for additional data
  const { data: client } = useQuery({
    queryKey: ['client-ledger-info', searchedCode],
    queryFn: async () => {
      if (!searchedCode) return null;
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('inv_code', searchedCode)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!searchedCode,
  });

  // Fetch opening balance from balances_raw for start date
  const { data: openingBalanceData } = useQuery({
    queryKey: ['opening-balance', searchedCode, startDate?.toISOString()],
    queryFn: async () => {
      if (!searchedCode || !startDate) return null;
      const dateStr = format(startDate, 'yyyy-MM-dd');
      
      // Get the balance as of the day before start date (opening balance)
      const { data, error } = await supabase
        .from('balances_raw')
        .select('ledger_balance')
        .eq('investor_code', searchedCode)
        .eq('as_of_date', dateStr)
        .limit(1);
      
      if (error) throw error;
      // Sum up ledger_balance (should be same across instruments for same investor)
      if (data && data.length > 0) {
        return data[0].ledger_balance || 0;
      }
      return 0;
    },
    enabled: !!searchedCode && !!startDate,
  });

  // Fetch trades for the period
  const { data: trades } = useQuery({
    queryKey: ['ledger-trades', searchedCode, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!searchedCode || !startDate || !endDate) return [];
      
      const startStr = format(startDate, 'yyyyMMdd');
      const endStr = format(endDate, 'yyyyMMdd');
      
      const { data, error } = await supabase
        .from('trade_history')
        .select('trade_date, side, security_code, quantity, price, value')
        .eq('client_code', searchedCode)
        .gte('trade_date', startStr)
        .lte('trade_date', endStr)
        .order('trade_date', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!searchedCode && !!startDate && !!endDate,
  });

  // Fetch deposits/withdrawals for the period
  const { data: transactions } = useQuery({
    queryKey: ['ledger-transactions', searchedCode, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!searchedCode || !startDate || !endDate) return [];
      
      const startStr = format(startDate, 'yyyy-MM-dd');
      const endStr = format(endDate, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('deposits_withdrawals')
        .select('transaction_date, transaction_type, amount, remarks')
        .eq('investor_code', searchedCode)
        .gte('transaction_date', startStr)
        .lte('transaction_date', endStr)
        .order('transaction_date', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!searchedCode && !!startDate && !!endDate,
  });

  // Calculate total deposits
  const totalDeposits = useMemo(() => {
    if (!transactions) return 0;
    return transactions
      .filter(t => t.transaction_type === 'Deposit')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [transactions]);

  // Build ledger with running balance
  const ledgerData = useMemo(() => {
    const openingBalance = openingBalanceData || 0;
    const items: LedgerTransaction[] = [];
    
    // Combine trades and transactions
    const allItems: Array<{
      date: string;
      sortDate: string;
      operation: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
      details: string;
      quantity: number | null;
      rate: number | null;
      debit: number;
      credit: number;
    }> = [];

    // Aggregate trades by date + security_code + side
    const tradeAggregates: Record<string, {
      date: string;
      sortDate: string;
      side: string;
      security_code: string;
      totalQty: number;
      totalValue: number;
    }> = {};

    trades?.forEach(trade => {
      const key = `${trade.trade_date}_${trade.security_code}_${trade.side}`;
      const qty = Number(trade.quantity) || 0;
      const value = Number(trade.value) || 0;

      if (!tradeAggregates[key]) {
        tradeAggregates[key] = {
          date: trade.trade_date || '',
          sortDate: trade.trade_date || '',
          side: trade.side || '',
          security_code: trade.security_code || 'Unknown',
          totalQty: 0,
          totalValue: 0,
        };
      }
      tradeAggregates[key].totalQty += qty;
      tradeAggregates[key].totalValue += value;
    });

    // Convert aggregated trades to ledger items
    Object.values(tradeAggregates).forEach(agg => {
      const isBuy = agg.side?.toUpperCase() === 'BUY' || agg.side?.toUpperCase() === 'B';
      const isSell = agg.side?.toUpperCase() === 'SELL' || agg.side?.toUpperCase() === 'S';
      
      // Format trade_date from YYYYMMDD to display format
      const dateStr = agg.sortDate;
      const formattedDate = dateStr.length === 8 
        ? `${dateStr.slice(6, 8)}-${getMonthName(dateStr.slice(4, 6))}-${dateStr.slice(0, 4)}`
        : dateStr;

      // Calculate average rate
      const avgRate = agg.totalQty > 0 ? agg.totalValue / agg.totalQty : 0;

      allItems.push({
        date: formattedDate,
        sortDate: dateStr,
        operation: isBuy ? 'BUY' : 'SELL',
        details: `${isBuy ? 'Bought' : 'Sold'} ${agg.security_code}`,
        quantity: agg.totalQty,
        rate: avgRate,
        debit: isBuy ? agg.totalValue : 0,
        credit: isSell ? agg.totalValue : 0,
      });
    });

    // Add deposits/withdrawals
    transactions?.forEach(tx => {
      const isDeposit = tx.transaction_type === 'Deposit';
      const amount = Number(tx.amount) || 0;
      const dateStr = tx.transaction_date || '';
      const formattedDate = dateStr 
        ? format(parseISO(dateStr), 'dd-MMM-yyyy')
        : dateStr;
      
      allItems.push({
        date: formattedDate,
        sortDate: dateStr.replace(/-/g, ''),
        operation: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
        details: tx.remarks || (isDeposit ? 'Cash Deposit' : 'Cash Withdrawal'),
        quantity: null,
        rate: null,
        debit: isDeposit ? 0 : amount,
        credit: isDeposit ? amount : 0,
      });
    });

    // Sort by date
    allItems.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

    // Calculate running balance
    let runningBalance = openingBalance;
    allItems.forEach(item => {
      runningBalance = runningBalance - item.debit + item.credit;
      items.push({
        ...item,
        balance: runningBalance,
      });
    });

    return {
      items,
      openingBalance,
      totalDebit: allItems.reduce((sum, i) => sum + i.debit, 0),
      totalCredit: allItems.reduce((sum, i) => sum + i.credit, 0),
      closingBalance: runningBalance,
    };
  }, [trades, transactions, openingBalanceData]);

  const handleSearch = () => {
    if (investorCode.trim()) {
      setSearchedCode(investorCode.trim());
    }
  };

  const getMonthName = (month: string): string => {
    const months: Record<string, string> = {
      '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
      '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
      '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
    };
    return months[month] || month;
  };

  const handleExport = () => {
    if (!ledgerData.items.length || !investor) return;

    const headers = ['Date', 'Operation', 'Details', 'Quantity', 'Rate', 'Debit', 'Credit', 'Balance'];
    const rows = ledgerData.items.map(item => [
      item.date,
      item.operation,
      item.details,
      item.quantity?.toString() || '',
      item.rate?.toString() || '',
      item.debit.toFixed(2),
      item.credit.toFixed(2),
      item.balance.toFixed(2),
    ]);

    const csvContent = [
      `Investor Ledger Statement - ${investor.investor_code}`,
      `Account Name: ${investor.investor_name}`,
      `Date Range: ${startDate ? format(startDate, 'dd-MMM-yyyy') : ''} to ${endDate ? format(endDate, 'dd-MMM-yyyy') : ''}`,
      `Opening Balance: ${formatCurrency(ledgerData.openingBalance)}`,
      '',
      headers.join(','),
      ...rows.map(r => r.join(',')),
      '',
      `Closing Balance:,,,,,${formatCurrency(ledgerData.totalDebit)},${formatCurrency(ledgerData.totalCredit)},${formatCurrency(ledgerData.closingBalance)}`,
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_${investor.investor_code}_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
  };

  return (
    <MainLayout 
      title="Investor Ledger Statement" 
      subtitle="View detailed transaction ledger for investors"
    >
      {/* Search and Filter Section */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Investor Code Search */}
            <div className="space-y-2">
              <Label>Account No</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter investor code"
                  value={investorCode}
                  onChange={(e) => setInvestorCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button onClick={handleSearch} size="icon">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label>From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "dd-MMM-yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label>To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "dd-MMM-yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Export Button */}
            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button 
                onClick={handleExport} 
                disabled={!ledgerData.items.length}
                className="w-full"
                variant="outline"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Investor Info Header */}
      {investor && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Investor Ledger Statement Summary</h2>
            </div>
            
            {startDate && endDate && (
              <p className="text-sm text-muted-foreground mb-4">
                From <span className="font-medium text-foreground">{format(startDate, 'dd-MMM-yyyy')}</span> To{' '}
                <span className="font-medium text-foreground">{format(endDate, 'dd-MMM-yyyy')}</span>
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left Column */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-28">Account No</span>
                  <span className="font-medium">: {investor.investor_code}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-28">BOID</span>
                  <span className="font-medium">: {investor.bo_id || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-28">Account Name</span>
                  <span className="font-medium">: {investor.investor_name}</span>
                </div>
              </div>

              {/* Middle Column */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-36">Account Type</span>
                  <span className="font-medium">: {investor.account_type || 'Individual Account'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-36">Account Status</span>
                  <span className="font-medium">: <Badge variant={investor.status === 'Active' ? 'default' : 'secondary'}>{investor.status || 'Active'}</Badge></span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-36">Account Category</span>
                  <span className="font-medium">: {investor.investor_type || 'Non Margin'}</span>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-2 text-right">
                <div className="flex justify-end gap-2">
                  <span className="text-muted-foreground">Receivable Amount :</span>
                  <span className="font-medium w-32">{formatCurrency(0)}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <span className="text-muted-foreground">Total Deposit :</span>
                  <span className="font-medium w-32 text-success">{formatCurrency(totalDeposits)}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <span className="text-muted-foreground">Opening Balance :</span>
                  <span className="font-medium w-32">{formatCurrency(ledgerData.openingBalance)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ledger Table */}
      {searchedCode && startDate && endDate && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-primary/10 hover:bg-primary/10">
                    <TableHead className="text-foreground font-semibold">Date</TableHead>
                    <TableHead className="text-foreground font-semibold">Operation</TableHead>
                    <TableHead className="text-foreground font-semibold">Details</TableHead>
                    <TableHead className="text-foreground font-semibold text-right">Quantity</TableHead>
                    <TableHead className="text-foreground font-semibold text-right">Rate</TableHead>
                    <TableHead className="text-foreground font-semibold text-right">Debit</TableHead>
                    <TableHead className="text-foreground font-semibold text-right">Credit</TableHead>
                    <TableHead className="text-foreground font-semibold text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerData.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No transactions found for the selected period
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {ledgerData.items.map((item, idx) => (
                        <TableRow key={idx} className="border-border">
                          <TableCell>{item.date}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={item.operation === 'BUY' || item.operation === 'WITHDRAWAL' ? 'destructive' : 'default'}
                              className={cn(
                                item.operation === 'SELL' || item.operation === 'DEPOSIT' 
                                  ? 'bg-success/20 text-success hover:bg-success/30' 
                                  : ''
                              )}
                            >
                              {item.operation}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.details}</TableCell>
                          <TableCell className="text-right">{formatNumber(item.quantity)}</TableCell>
                          <TableCell className="text-right">{formatNumber(item.rate)}</TableCell>
                          <TableCell className={cn("text-right", item.debit > 0 && "text-destructive")}>
                            {item.debit > 0 ? formatCurrency(item.debit) : '0.00'}
                          </TableCell>
                          <TableCell className={cn("text-right", item.credit > 0 && "text-success")}>
                            {item.credit > 0 ? formatCurrency(item.credit) : '0.00'}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", item.balance < 0 ? "text-destructive" : "")}>
                            {formatCurrency(item.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      
                      {/* Closing Balance Row */}
                      <TableRow className="border-t-2 border-border bg-muted/50 font-semibold">
                        <TableCell colSpan={5} className="text-right">Closing Balance :</TableCell>
                        <TableCell className="text-right text-destructive">
                          {formatCurrency(ledgerData.totalDebit)}
                        </TableCell>
                        <TableCell className="text-right text-success">
                          {formatCurrency(ledgerData.totalCredit)}
                        </TableCell>
                        <TableCell className={cn("text-right", ledgerData.closingBalance < 0 ? "text-destructive" : "")}>
                          {formatCurrency(ledgerData.closingBalance)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!searchedCode && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Enter an Investor Code</h3>
            <p className="text-muted-foreground">
              Search for an investor and select a date range to view their ledger statement
            </p>
          </CardContent>
        </Card>
      )}
    </MainLayout>
  );
};

export default InvestorLedgerPage;
