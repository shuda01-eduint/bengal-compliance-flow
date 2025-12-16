import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, TrendingUp, TrendingDown, Wallet, AlertCircle, ChevronDown, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportBalancesRawDialog } from "@/components/admin/ImportBalancesRawDialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  BalanceRawRow,
  EnrichedBalanceRow,
  enrichBalanceRow,
  calculateSummary,
  groupByInvestor,
  groupByInstrument,
  formatCurrency,
  formatNumber,
  formatPercent,
  InvestorGroupedRow,
  InstrumentSummary,
} from "@/lib/balance-utils";

type SortField = 'investor_code' | 'instrument' | 'total_stock' | 'saleable' | 'avg_cost' | 'total_cost' | 'total_mv' | 'unrealized_pnl' | 'pnl_pct' | 'ledger_balance' | 'matured_balance' | 'receivable_sale' | 'cq_in_transit' | 'net_available' | 'risk_flag';
type SortDirection = 'asc' | 'desc';

const ROWS_PER_PAGE = 50;

const AdminBalancesPage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [onlyNegativeLedger, setOnlyNegativeLedger] = useState(false);
  const [onlyReceivables, setOnlyReceivables] = useState(false);
  const [groupByInvestorView, setGroupByInvestorView] = useState(false);
  const [expandedInvestors, setExpandedInvestors] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('investor_code');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // Fetch available dates
  const { data: availableDates } = useQuery({
    queryKey: ['balances-raw-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('balances_raw')
        .select('as_of_date')
        .order('as_of_date', { ascending: false });
      
      if (error) throw error;
      const uniqueDates = [...new Set(data.map(d => d.as_of_date))];
      return uniqueDates;
    },
  });

  // Set default date to latest available
  useMemo(() => {
    if (availableDates && availableDates.length > 0 && !selectedDate) {
      setSelectedDate(parseISO(availableDates[0]));
    }
  }, [availableDates, selectedDate]);

  // Fetch raw balance data for selected date
  const { data: rawBalances, isLoading, error } = useQuery({
    queryKey: ['balances-raw', selectedDate?.toISOString()],
    queryFn: async () => {
      if (!selectedDate) return [];
      
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      let allData: BalanceRawRow[] = [];
      let from = 0;
      const batchSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from('balances_raw')
          .select('*')
          .eq('as_of_date', dateStr)
          .range(from, from + batchSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData = [...allData, ...data as BalanceRawRow[]];
        if (data.length < batchSize) break;
        from += batchSize;
      }

      return allData;
    },
    enabled: !!selectedDate,
  });

  // Enrich data with computed fields
  const enrichedData = useMemo(() => {
    if (!rawBalances) return [];
    return rawBalances.map(enrichBalanceRow);
  }, [rawBalances]);

  // Calculate summary
  const summary = useMemo(() => {
    return calculateSummary(enrichedData);
  }, [enrichedData]);

  // Apply filters
  const filteredData = useMemo(() => {
    return enrichedData.filter(row => {
      // Search filter
      const matchesSearch = searchQuery === '' ||
        row.investor_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (row.instrument?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

      // Risk filter
      const matchesRisk = riskFilter === 'all' || row.risk_flag === riskFilter;

      // Negative ledger filter
      const matchesNegative = !onlyNegativeLedger || row.ledger_balance < 0;

      // Receivables filter
      const matchesReceivables = !onlyReceivables || (row.receivable_sale + row.cq_in_transit) > 0;

      return matchesSearch && matchesRisk && matchesNegative && matchesReceivables;
    });
  }, [enrichedData, searchQuery, riskFilter, onlyNegativeLedger, onlyReceivables]);

  // Sort data
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'risk_flag') {
        const riskOrder = { 'High': 3, 'Watch': 2, 'OK': 1 };
        aVal = riskOrder[a.risk_flag];
        bVal = riskOrder[b.risk_flag];
      }

      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [filteredData, sortField, sortDirection]);

  // Paginate
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return sortedData.slice(start, start + ROWS_PER_PAGE);
  }, [sortedData, currentPage]);

  const totalPages = Math.ceil(sortedData.length / ROWS_PER_PAGE);

  // Group by investor
  const investorGroups = useMemo(() => {
    return groupByInvestor(filteredData);
  }, [filteredData]);

  // Group by instrument for second tab
  const instrumentSummary = useMemo(() => {
    return groupByInstrument(enrichedData);
  }, [enrichedData]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const toggleInvestorExpand = (code: string) => {
    setExpandedInvestors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(code)) {
        newSet.delete(code);
      } else {
        newSet.add(code);
      }
      return newSet;
    });
  };

  const handleImportComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['balances-raw'] });
    queryClient.invalidateQueries({ queryKey: ['balances-raw-dates'] });
  };

  const getRiskBadge = (risk: 'OK' | 'Watch' | 'High') => {
    switch (risk) {
      case 'High':
        return <Badge variant="destructive">High</Badge>;
      case 'Watch':
        return <Badge className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">Watch</Badge>;
      default:
        return <Badge variant="secondary">OK</Badge>;
    }
  };

  const SortableHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <TableHead 
      className={cn("text-muted-foreground cursor-pointer hover:text-foreground select-none", className)}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </TableHead>
  );

  if (error) {
    return (
      <MainLayout title="Admin Balances" subtitle="Balance data analysis">
        <div className="glass-card rounded-xl p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Error loading data</h3>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout 
      title="Admin Balances" 
      subtitle="Balance data analysis by investor and instrument"
    >
      {/* Sticky Summary Bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-4 border-b border-border mb-6">
        <div className="flex justify-between items-start mb-4">
          {/* Date Picker */}
          <div className="flex items-center gap-4">
            <Label>As of Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
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
                    if (!availableDates) return true;
                    return !availableDates.includes(format(date, 'yyyy-MM-dd'));
                  }}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <ImportBalancesRawDialog onImportComplete={handleImportComplete} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Investors</span>
            </div>
            <p className="text-xl font-semibold">{summary.total_clients}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Market Value</span>
            </div>
            <p className="text-xl font-semibold">{formatCurrency(summary.total_mv_sum)}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Cost</span>
            </div>
            <p className="text-xl font-semibold">{formatCurrency(summary.total_cost_sum)}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              {summary.unrealized_pnl_sum >= 0 ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className="text-xs text-muted-foreground">Unrealized P&L</span>
            </div>
            <p className={cn("text-xl font-semibold", summary.unrealized_pnl_sum >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(summary.unrealized_pnl_sum)}
            </p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Negative Ledger</span>
            </div>
            <p className="text-xl font-semibold text-destructive">{summary.negative_ledger_clients_count}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Receivables</span>
            </div>
            <p className="text-xl font-semibold text-amber-400">
              {formatCurrency(summary.receivable_sum + summary.cq_sum)}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Holdings</TabsTrigger>
          <TabsTrigger value="by-instrument">By Instrument</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {/* Filters Panel */}
          <div className="flex flex-wrap items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search investor code or instrument..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-10 bg-secondary border-border"
              />
            </div>

            <Select value={riskFilter} onValueChange={(v) => { setRiskFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[140px] bg-secondary border-border">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="Watch">Watch</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch 
                id="negative" 
                checked={onlyNegativeLedger} 
                onCheckedChange={(v) => { setOnlyNegativeLedger(v); setCurrentPage(1); }}
              />
              <Label htmlFor="negative" className="text-sm cursor-pointer">Negative ledger</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch 
                id="receivables" 
                checked={onlyReceivables} 
                onCheckedChange={(v) => { setOnlyReceivables(v); setCurrentPage(1); }}
              />
              <Label htmlFor="receivables" className="text-sm cursor-pointer">Receivables &gt; 0</Label>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Switch 
                id="group" 
                checked={groupByInvestorView} 
                onCheckedChange={setGroupByInvestorView}
              />
              <Label htmlFor="group" className="text-sm cursor-pointer">Group by Investor</Label>
            </div>
          </div>

          {/* Main Data Grid */}
          <div className="glass-card rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-muted-foreground">Loading balance data...</p>
              </div>
            ) : sortedData.length === 0 ? (
              <div className="p-12 text-center">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No data found for the selected criteria</p>
              </div>
            ) : groupByInvestorView ? (
              // Grouped view
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="text-muted-foreground">Investor Code</TableHead>
                      <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                      <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                      <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                      <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                      <TableHead className="text-muted-foreground text-right">Ledger Balance</TableHead>
                      <TableHead className="text-muted-foreground">Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {investorGroups.map((group) => (
                      <>
                        <TableRow 
                          key={group.investor_code} 
                          className={cn(
                            "border-border cursor-pointer",
                            group.risk_flag === 'High' && "bg-destructive/10",
                            group.risk_flag === 'Watch' && "bg-amber-500/10"
                          )}
                          onClick={() => toggleInvestorExpand(group.investor_code)}
                        >
                          <TableCell>
                            {expandedInvestors.has(group.investor_code) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{group.investor_code}</TableCell>
                          <TableCell className="text-right">{formatNumber(group.total_cost)}</TableCell>
                          <TableCell className="text-right">{formatNumber(group.total_mv)}</TableCell>
                          <TableCell className={cn("text-right", group.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(group.unrealized_pnl)}
                          </TableCell>
                          <TableCell className={cn("text-right", (group.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                            {formatPercent(group.pnl_pct)}
                          </TableCell>
                          <TableCell className={cn("text-right", group.ledger_balance < 0 && "text-destructive")}>
                            {formatNumber(group.ledger_balance)}
                          </TableCell>
                          <TableCell>{getRiskBadge(group.risk_flag)}</TableCell>
                        </TableRow>
                        {expandedInvestors.has(group.investor_code) && (
                          group.instruments.map((inst) => (
                            <TableRow key={inst.id} className="border-border bg-muted/30">
                              <TableCell></TableCell>
                              <TableCell className="pl-8 text-muted-foreground">{inst.instrument || '—'}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{formatNumber(inst.total_cost)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{formatNumber(inst.total_mv)}</TableCell>
                              <TableCell className={cn("text-right", inst.unrealized_pnl >= 0 ? "text-success/70" : "text-destructive/70")}>
                                {formatNumber(inst.unrealized_pnl)}
                              </TableCell>
                              <TableCell className={cn("text-right", (inst.pnl_pct ?? 0) >= 0 ? "text-success/70" : "text-destructive/70")}>
                                {formatPercent(inst.pnl_pct)}
                              </TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                            </TableRow>
                          ))
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              // Flat view with all columns
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                        <SortableHeader field="investor_code">Investor Code</SortableHeader>
                        <SortableHeader field="instrument">Instrument</SortableHeader>
                        <SortableHeader field="total_stock" className="text-right">Total Qty</SortableHeader>
                        <SortableHeader field="saleable" className="text-right">Saleable</SortableHeader>
                        <SortableHeader field="avg_cost" className="text-right">Avg Cost</SortableHeader>
                        <SortableHeader field="total_cost" className="text-right">Total Cost</SortableHeader>
                        <SortableHeader field="total_mv" className="text-right">Total M.V.</SortableHeader>
                        <SortableHeader field="unrealized_pnl" className="text-right">P&L</SortableHeader>
                        <SortableHeader field="pnl_pct" className="text-right">P&L %</SortableHeader>
                        <SortableHeader field="ledger_balance" className="text-right">Ledger</SortableHeader>
                        <SortableHeader field="matured_balance" className="text-right">Matured</SortableHeader>
                        <SortableHeader field="receivable_sale" className="text-right">Receivable</SortableHeader>
                        <SortableHeader field="cq_in_transit" className="text-right">CQ</SortableHeader>
                        <SortableHeader field="net_available" className="text-right">Net Avail.</SortableHeader>
                        <SortableHeader field="risk_flag">Risk</SortableHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedData.map((row) => (
                        <TableRow 
                          key={row.id} 
                          className={cn(
                            "border-border",
                            row.risk_flag === 'High' && "bg-destructive/10 hover:bg-destructive/15",
                            row.risk_flag === 'Watch' && "bg-amber-500/10 hover:bg-amber-500/15"
                          )}
                        >
                          <TableCell className="font-medium">{row.investor_code}</TableCell>
                          <TableCell>{row.instrument || '—'}</TableCell>
                          <TableCell className="text-right">{row.total_stock.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.saleable.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{formatNumber(row.avg_cost)}</TableCell>
                          <TableCell className="text-right">{formatNumber(row.total_cost)}</TableCell>
                          <TableCell className="text-right">{formatNumber(row.total_mv)}</TableCell>
                          <TableCell className={cn("text-right", row.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(row.unrealized_pnl)}
                          </TableCell>
                          <TableCell className={cn("text-right", (row.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                            {formatPercent(row.pnl_pct)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.ledger_balance < 0 && "text-destructive")}>
                            {formatNumber(row.ledger_balance)}
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(row.matured_balance)}</TableCell>
                          <TableCell className="text-right">
                            {row.receivable_sale > 0 ? (
                              <Badge className="bg-amber-500/20 text-amber-400">{formatNumber(row.receivable_sale)}</Badge>
                            ) : formatNumber(row.receivable_sale)}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.cq_in_transit > 0 ? (
                              <Badge className="bg-amber-500/20 text-amber-400">{formatNumber(row.cq_in_transit)}</Badge>
                            ) : formatNumber(row.cq_in_transit)}
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(row.net_available)}</TableCell>
                          <TableCell>{getRiskBadge(row.risk_flag)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Showing {((currentPage - 1) * ROWS_PER_PAGE) + 1} to {Math.min(currentPage * ROWS_PER_PAGE, sortedData.length)} of {sortedData.length} rows
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="flex items-center px-3 text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="by-instrument" className="space-y-4">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">Instrument</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Qty</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Investors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instrumentSummary
                    .sort((a, b) => b.total_mv - a.total_mv)
                    .map((inst) => (
                    <TableRow key={inst.instrument} className="border-border hover:bg-secondary/30">
                      <TableCell className="font-medium">{inst.instrument}</TableCell>
                      <TableCell className="text-right">{inst.total_qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{formatNumber(inst.total_cost)}</TableCell>
                      <TableCell className="text-right">{formatNumber(inst.total_mv)}</TableCell>
                      <TableCell className={cn("text-right", inst.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                        {formatNumber(inst.unrealized_pnl)}
                      </TableCell>
                      <TableCell className={cn("text-right", (inst.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                        {formatPercent(inst.pnl_pct)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{inst.investor_count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default AdminBalancesPage;
