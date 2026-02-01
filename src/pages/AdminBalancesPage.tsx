import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarIcon, Upload, CheckCircle2, AlertTriangle, Clock, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight, Users, Wallet, PiggyBank } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImportAdminBalanceDialog } from "@/components/admin/ImportAdminBalanceDialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO, isToday, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const formatBDT = (value: number) => {
  if (value >= 10000000) {
    return `৳${(value / 10000000).toFixed(2)} Cr`;
  } else if (value >= 100000) {
    return `৳${(value / 100000).toFixed(2)} L`;
  }
  return `৳${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const AdminBalancesPage = () => {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 10;

  // Fetch available dates for the calendar
  const { data: availableDates } = useQuery({
    queryKey: ['balances-raw-dates'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_balance_dates');
      if (error) throw error;
      return (data || []).map((d: { as_of_date: string }) => d.as_of_date);
    },
  });

  // Set default date to latest available
  useMemo(() => {
    if (availableDates && availableDates.length > 0 && !selectedDate) {
      setSelectedDate(parseISO(availableDates[0]));
    }
  }, [availableDates, selectedDate]);

  // Fetch import history and summary statistics
  const { data: importHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['admin-balance-import-history'],
    queryFn: async () => {
      // Get unique dates from eod_investor_balance with their record counts
      const { data, error } = await supabase
        .from('eod_investor_balance')
        .select('trade_date')
        .order('trade_date', { ascending: false });
      
      if (error) throw error;
      
      // Group by date and count records
      const dateMap = new Map<string, number>();
      data?.forEach(row => {
        const date = row.trade_date;
        dateMap.set(date, (dateMap.get(date) || 0) + 1);
      });
      
      // Also get import timestamps from eod_run_history if available
      const { data: runHistory } = await supabase
        .from('eod_run_history')
        .select('run_date, run_at, run_by_email, clients_captured, status, notes')
        .order('run_at', { ascending: false })
        .limit(50);
      
      // Create a map for run history
      const runMap = new Map<string, typeof runHistory[0]>();
      runHistory?.forEach(run => {
        if (!runMap.has(run.run_date)) {
          runMap.set(run.run_date, run);
        }
      });
      
      // Combine data
      const result = Array.from(dateMap.entries()).map(([date, count]) => {
        const run = runMap.get(date);
        return {
          date,
          recordCount: count,
          importedAt: run?.run_at || null,
          importedBy: run?.run_by_email || 'System',
          status: run?.status || 'completed',
          notes: run?.notes || null,
        };
      });
      
      return result;
    },
    staleTime: 60 * 1000,
  });

  // Fetch latest summary statistics for the cards
  const { data: summaryStats } = useQuery({
    queryKey: ['admin-balance-summary-stats'],
    queryFn: async () => {
      // Get account type distribution from investors table
      const { data: investorStats, error: investorError } = await supabase
        .from('investors')
        .select('account_type');
      
      if (investorError) throw investorError;
      
      let totalInvestors = investorStats?.length || 0;
      let marginInvestors = 0;
      let cashInvestors = 0;
      
      investorStats?.forEach(inv => {
        if (inv.account_type?.toLowerCase() === 'margin') {
          marginInvestors++;
        } else {
          cashInvestors++;
        }
      });

      // Get latest EOD balance data for loan and interest
      const { data: latestDate } = await supabase
        .from('eod_investor_balance')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1)
        .single();

      let accruedInterest = 0;
      let marginLoanAmount = 0;

      if (latestDate?.trade_date) {
        const { data: balanceStats } = await supabase
          .from('eod_investor_balance')
          .select('accrued_int, closing_ledger_balance')
          .eq('trade_date', latestDate.trade_date);

        balanceStats?.forEach(b => {
          accruedInterest += b.accrued_int || 0;
          if (b.closing_ledger_balance < 0) {
            marginLoanAmount += Math.abs(b.closing_ledger_balance);
          }
        });
      }

      return {
        totalInvestors,
        marginInvestors,
        cashInvestors,
        accruedInterest,
        marginLoanAmount,
      };
    },
    staleTime: 60 * 1000,
  });

  // Get today's status
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayImported = availableDates?.includes(todayStr) || false;

  // Get last import summary
  const lastImport = importHistory?.[0];

  // Pagination for history
  const totalPages = Math.ceil((importHistory?.length || 0) / HISTORY_PAGE_SIZE);
  const paginatedHistory = importHistory?.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE
  );

  const handleImportComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['balances-raw-dates'] });
    queryClient.invalidateQueries({ queryKey: ['admin-balance-import-history'] });
    queryClient.invalidateQueries({ queryKey: ['admin-balance-summary-stats'] });
  };

  return (
    <MainLayout 
      title="Admin Balance Import" 
      subtitle="Import and manage investor balance baselines"
    >
      <div className="space-y-6">
        {/* Top Controls Bar */}
        <div className="flex flex-wrap justify-between items-center gap-4 p-4 glass-card rounded-xl">
          {/* Date Picker */}
          <div className="flex items-center gap-4">
            <Label className="text-sm font-medium">As of Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[220px] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => {
                    if (date > new Date()) return true;
                    if (!availableDates || availableDates.length === 0) return false;
                    const dateStr = format(date, 'yyyy-MM-dd');
                    return !availableDates.includes(dateStr);
                  }}
                  initialFocus
                  modifiers={{
                    hasData: availableDates?.map(d => parseISO(d)) || []
                  }}
                  modifiersStyles={{
                    hasData: { fontWeight: 'bold', color: 'hsl(var(--primary))' }
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Import Button - Prominent */}
          <ImportAdminBalanceDialog onSuccess={handleImportComplete} />
        </div>

        {/* Status Cards Row - 4 cards in responsive grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Today's Import Status */}
          <Card className={cn(
            "border-2",
            todayImported 
              ? "border-success/30 bg-success/5" 
              : "border-warning/30 bg-warning/5"
          )}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                {todayImported ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-warning" />
                )}
                <CardTitle className="text-base">Today's Import Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge 
                  variant={todayImported ? "default" : "secondary"}
                  className={cn(
                    "text-sm",
                    todayImported 
                      ? "bg-success/20 text-success border-success/30" 
                      : "bg-warning/20 text-warning border-warning/30"
                  )}
                >
                  {todayImported ? "Imported" : "Not Imported"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(), 'MMM dd, yyyy')}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Last Import */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Last Import</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {lastImport ? (
                <div className="space-y-1">
                  <p className="text-lg font-semibold">
                    {format(parseISO(lastImport.date), 'MMM dd, yyyy')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {lastImport.importedAt 
                      ? formatDistanceToNow(parseISO(lastImport.importedAt), { addSuffix: true })
                      : 'Import time unknown'
                    }
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No imports yet</p>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Investor Summary */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Investor Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-lg font-bold">{(summaryStats?.totalInvestors || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Margin</span>
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                    {(summaryStats?.marginInvestors || 0).toLocaleString()}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Cash</span>
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                    {(summaryStats?.cashInvestors || 0).toLocaleString()}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Loan & Interest Summary */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Loan & Interest</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Accrued Interest</span>
                  <span className="font-semibold text-success">
                    {formatBDT(summaryStats?.accruedInterest || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Margin Loan</span>
                  <span className="font-semibold text-destructive">
                    {formatBDT(summaryStats?.marginLoanAmount || 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Import History Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Admin Balance Import History</CardTitle>
              </div>
              <CardDescription>
                {importHistory?.length || 0} dates with balance data
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading import history...</span>
              </div>
            ) : !paginatedHistory || paginatedHistory.length === 0 ? (
              <div className="text-center py-8">
                <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No balance data imported yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Use the "Import Admin Balance Baseline" button above to get started
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Balance Date</TableHead>
                        <TableHead>Imported At</TableHead>
                        <TableHead>Imported By</TableHead>
                        <TableHead className="text-right">Total Records</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedHistory.map((item) => (
                        <TableRow key={item.date}>
                          <TableCell className="font-medium">
                            {format(parseISO(item.date), 'MMM dd, yyyy')}
                            {isToday(parseISO(item.date)) && (
                              <Badge variant="secondary" className="ml-2 text-xs">Today</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.importedAt 
                              ? format(parseISO(item.importedAt), 'MMM dd, yyyy HH:mm')
                              : '—'
                            }
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.importedBy?.split('@')[0] || 'System'}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.recordCount.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={item.status === 'completed' ? 'default' : 'secondary'}
                              className={cn(
                                item.status === 'completed' 
                                  ? 'bg-success/20 text-success border-success/30' 
                                  : ''
                              )}
                            >
                              {item.status === 'completed' ? 'Success' : item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {((historyPage - 1) * HISTORY_PAGE_SIZE) + 1} to {Math.min(historyPage * HISTORY_PAGE_SIZE, importHistory?.length || 0)} of {importHistory?.length || 0}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                        disabled={historyPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {historyPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                        disabled={historyPage === totalPages}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default AdminBalancesPage;
