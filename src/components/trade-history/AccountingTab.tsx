import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Search, Download, Wallet, TrendingUp, Percent, Users } from "lucide-react";
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

const AccountingTab = () => {
  const [searchTerm, setSearchTerm] = useState("");

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

    // Build rows for margin accounts
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

      rows.push({
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
      });
    });

    return rows;
  }, [investors, clients, transactions, trades]);

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

  const handleExport = () => {
    const headers = ['Code', 'Name', 'Account Type', 'Interest Rate', 'Commission', 'Ledger Balance', 'Deposits', 'Withdrawals', 'Net Sell', 'Adjusted Ledger', 'Accrued Interest', 'Recv/Pay'];
    const csvData = filteredData.map(row => [
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
    ]);
    
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
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {latestTradeDate && (
            <span className="text-sm text-muted-foreground">Trade Date: {latestTradeDate}</span>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Data Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Accounting Details</CardTitle>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.slice(0, 100).map((row) => (
                    <TableRow key={row.investor_code}>
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
    </div>
  );
};

export default AccountingTab;
