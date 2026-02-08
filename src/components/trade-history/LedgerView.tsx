import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { Search, CalendarIcon, ArrowDownRight, ArrowUpRight, TrendingUp, Download } from "lucide-react";
import { formatCurrency } from "@/lib/balance-utils";
import { useDebounce } from "@/hooks/useDebounce";
import { InvestorLedgerDrilldown } from "./InvestorLedgerDrilldown";
import { rpcWithRetry, formatRpcError } from "@/lib/rpc-utils";

interface LedgerViewProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

interface LedgerRow {
  investor_code: string;
  investor_name: string | null;
  account_type: string | null;
  rm_name: string | null;
  department: string | null;
  total_deposits: number;
  total_withdrawals: number;
  gross_buy: number;
  gross_sell: number;
  total_commission: number;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
}

interface DashboardSummary {
  eod_date: string;
  total_credit: number;
  total_debit: number;
  net_balance: number;
  client_count: number;
}

// Normalize a date to local midnight to avoid timezone issues with react-day-picker
const normalizeToLocalDate = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const LedgerView = ({ selectedDate, onDateChange }: LedgerViewProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInvestor, setSelectedInvestor] = useState<LedgerRow | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  
  const debouncedSearch = useDebounce(searchTerm, 300);
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // Fetch dashboard summary from v_ledger_dashboard view
  const { data: summaryData, isLoading: loadingSummary } = useQuery({
    queryKey: ['ledger-dashboard-summary', selectedDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_ledger_dashboard')
        .select('*')
        .eq('eod_date', selectedDateStr)
        .maybeSingle();
      
      if (error) throw error;
      return data as DashboardSummary | null;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch ledger entries using RPC
  const { data: ledgerData, isLoading: loadingLedger, isError, error } = useQuery({
    queryKey: ['ledger-by-date', selectedDateStr, debouncedSearch],
    queryFn: async () => {
      const { data, error } = await rpcWithRetry<LedgerRow[]>(
        'get_ledger_by_date',
        {
          _eod_date: selectedDateStr,
          _search: debouncedSearch || null,
          _limit: 500
        }
      );
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleRowClick = (row: LedgerRow) => {
    setSelectedInvestor(row);
    setDrilldownOpen(true);
  };

  const handleExportCSV = () => {
    if (!ledgerData?.length) return;
    
    const headers = [
      'Investor Code', 'Investor Name', 'Account Type', 'RM', 'Department',
      'Opening Balance', 'Deposits', 'Withdrawals', 'Gross Buy', 'Gross Sell',
      'Commission', 'Total Debit', 'Total Credit', 'Closing Balance'
    ];
    
    const rows = ledgerData.map(row => [
      row.investor_code,
      row.investor_name || '',
      row.account_type || '',
      row.rm_name || '',
      row.department || '',
      row.opening_balance,
      row.total_deposits,
      row.total_withdrawals,
      row.gross_buy,
      row.gross_sell,
      row.total_commission,
      row.total_debit,
      row.total_credit,
      row.closing_balance
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${selectedDateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Date Picker */}
      <div className="flex items-center gap-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[240px] justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "PPP") : <span>Select EOD date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={normalizeToLocalDate(selectedDate)}
              onSelect={(date) => date && onDateChange(normalizeToLocalDate(date))}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent border-red-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Debit</p>
                {loadingSummary ? (
                  <Skeleton className="h-8 w-32 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-red-400">
                    {formatCurrency(summaryData?.total_debit || 0)}
                  </p>
                )}
              </div>
              <ArrowDownRight className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/20 via-green-500/10 to-transparent border-green-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Credit</p>
                {loadingSummary ? (
                  <Skeleton className="h-8 w-32 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-green-400">
                    {formatCurrency(summaryData?.total_credit || 0)}
                  </p>
                )}
              </div>
              <ArrowUpRight className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent border-blue-500/30">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Balance</p>
                {loadingSummary ? (
                  <Skeleton className="h-8 w-32 mt-1" />
                ) : (
                  <p className={cn(
                    "text-2xl font-bold",
                    (summaryData?.net_balance || 0) >= 0 ? "text-blue-400" : "text-amber-400"
                  )}>
                    {formatCurrency(summaryData?.net_balance || 0)}
                  </p>
                )}
              </div>
              <TrendingUp className="h-8 w-8 text-blue-400" />
            </div>
            {!loadingSummary && summaryData && (
              <p className="text-xs text-muted-foreground mt-2">
                {summaryData.client_count} clients
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Search and Export */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by investor code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={!ledgerData?.length}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Ledger Table */}
      <Card>
        <CardContent className="p-0">
          {loadingLedger ? (
            <div className="p-6 space-y-4">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center text-destructive">
              {formatRpcError(error as Error)}
            </div>
          ) : !ledgerData?.length ? (
            <div className="p-6 text-center text-muted-foreground">
              No ledger data available for {format(selectedDate, 'PPP')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor Code</TableHead>
                    <TableHead>Investor Name</TableHead>
                    <TableHead>Account Type</TableHead>
                    <TableHead>RM</TableHead>
                    <TableHead className="text-right">Opening Bal</TableHead>
                    <TableHead className="text-right text-green-400">Deposits</TableHead>
                    <TableHead className="text-right text-amber-400">Withdrawals</TableHead>
                    <TableHead className="text-right text-red-400">Buy</TableHead>
                    <TableHead className="text-right text-green-400">Sell</TableHead>
                    <TableHead className="text-right text-purple-400">Commission</TableHead>
                    <TableHead className="text-right text-blue-400">Closing Bal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerData.map((row) => (
                    <TableRow 
                      key={row.investor_code}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(row)}
                    >
                      <TableCell className="font-mono">{row.investor_code}</TableCell>
                      <TableCell>{row.investor_name || '-'}</TableCell>
                      <TableCell>{row.account_type || '-'}</TableCell>
                      <TableCell>{row.rm_name || '-'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.opening_balance)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-400">
                        {row.total_deposits > 0 ? formatCurrency(row.total_deposits) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-400">
                        {row.total_withdrawals > 0 ? formatCurrency(row.total_withdrawals) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-400">
                        {row.gross_buy > 0 ? formatCurrency(row.gross_buy) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-400">
                        {row.gross_sell > 0 ? formatCurrency(row.gross_sell) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-purple-400">
                        {row.total_commission > 0 ? formatCurrency(row.total_commission) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-blue-400">
                        {formatCurrency(row.closing_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drill-down Dialog */}
      {selectedInvestor && (
        <InvestorLedgerDrilldown
          open={drilldownOpen}
          onOpenChange={setDrilldownOpen}
          investorCode={selectedInvestor.investor_code}
          investorName={selectedInvestor.investor_name || selectedInvestor.investor_code}
          initialDate={selectedDate}
        />
      )}
    </div>
  );
};
