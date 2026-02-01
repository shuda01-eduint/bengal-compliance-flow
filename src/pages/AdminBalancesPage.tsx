import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useRef, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, TrendingUp, TrendingDown, Wallet, AlertCircle, ChevronDown, ChevronRight, Calendar as CalendarIcon, Eye, X, Percent } from "lucide-react";
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

import { CopyBalancesDialog } from "@/components/admin/CopyBalancesDialog";
import { ImportAdminBalanceDialog } from "@/components/admin/ImportAdminBalanceDialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Portfolio,
  groupByInvestor,
  groupByInstrument,
  groupByPortfolio,
  groupByRM,
  formatCurrency,
  formatNumber,
  formatPercent,
  EnrichedBalanceRow,
} from "@/lib/balance-utils";

// Type for enriched row from RPC
interface EnrichedBalanceRPCRow {
  id: string;
  as_of_date: string;
  investor_code: string;
  instrument: string | null;
  total_stock: number;
  saleable: number;
  avg_cost: number | null;
  total_cost: number | null;
  total_mv: number | null;
  ledger_balance: number | null;
  matured_balance: number | null;
  receivable_sale: number | null;
  cq_in_transit: number | null;
  rm_id: string | null;
  rm_name: string | null;
  rm_email: string | null;
  unrealized_pnl: number;
  pnl_pct: number | null;
  net_available: number;
  risk_flag: 'OK' | 'Watch' | 'High';
  adjusted_ledger: number;
  deposits: number;
  withdrawals: number;
  net_sell: number;
  net_buy: number;
  gross_buy: number;
  gross_sell: number;
  brokerage_amount: number;
  accrued_interest: number;
  receivable_payable: number;
  brokerage_commission_rate: number;
  interest_rate: number;
  account_type: string | null;
}

type SortField = 'investor_code' | 'instrument' | 'total_stock' | 'saleable' | 'avg_cost' | 'total_cost' | 'total_mv' | 'unrealized_pnl' | 'pnl_pct' | 'ledger_balance' | 'adjusted_ledger' | 'deposits' | 'withdrawals' | 'net_sell' | 'net_buy' | 'matured_balance' | 'receivable_sale' | 'cq_in_transit' | 'net_available' | 'risk_flag' | 'accrued_interest' | 'receivable_payable';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 40;

const AdminBalancesPage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [portfolioSearchQuery, setPortfolioSearchQuery] = useState("");
  const [rmSearchQuery, setRMSearchQuery] = useState("");
  const [compSearchQuery, setCompSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [onlyNegativeLedger, setOnlyNegativeLedger] = useState(false);
  const [onlyReceivables, setOnlyReceivables] = useState(false);
  const [groupByInvestorView, setGroupByInvestorView] = useState(false);
  const [expandedInvestors, setExpandedInvestors] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('investor_code');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [previewAsRM, setPreviewAsRM] = useState<string>("all");
  
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Fetch RMs for preview dropdown using optimized RPC function
  const { data: rmList } = useQuery({
    queryKey: ['rm-list-for-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_balance_rms');
      if (error) throw error;
      return (data || []).map((d: { rm_email: string; rm_name: string | null }) => ({
        email: d.rm_email,
        name: d.rm_name || d.rm_email,
      }));
    },
  });

  // Fetch available dates using optimized RPC function
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

  // Loading progress state
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0, batchNumber: 0 });

  // Fetch enriched balance data using optimized RPC - single query does all the work!
  const { data: enrichedData, isLoading, error, refetch: refetchBalances } = useQuery({
    queryKey: ['balances-enriched', selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined, previewAsRM],
    queryFn: async () => {
      if (!selectedDate) return [];
      
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const rmEmail = previewAsRM && previewAsRM !== 'all' ? previewAsRM : null;
      
      // Fetch all data in batches using keyset pagination
      // Using smaller batch size (2000) to avoid response truncation
      let allData: EnrichedBalanceRPCRow[] = [];
      let lastId: string | null = null;
      const batchSize = 2000;
      let batchNumber = 0;
      
      setLoadingProgress({ loaded: 0, total: 0, batchNumber: 0 });
      
      while (true) {
        batchNumber++;
        
        const { data, error } = await supabase.rpc('get_admin_balances_enriched', {
          p_date: dateStr,
          p_rm_email: rmEmail,
          p_limit: batchSize,
          p_cursor_id: lastId,
        });
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allData = [...allData, ...(data as EnrichedBalanceRPCRow[])];
        setLoadingProgress({ loaded: allData.length, total: allData.length, batchNumber });
        
        if (data.length < batchSize) break;
        lastId = data[data.length - 1]?.id ?? null;
        if (!lastId) break;
      }
      
      // Convert to EnrichedBalanceRow format for compatibility with existing grouping functions
      return allData.map(row => ({
        ...row,
        total_stock: row.total_stock ?? 0,
        saleable: row.saleable ?? 0,
        avg_cost: row.avg_cost ?? 0,
        total_cost: row.total_cost ?? 0,
        total_mv: row.total_mv ?? 0,
        ledger_balance: row.ledger_balance ?? 0,
        matured_balance: row.matured_balance ?? 0,
        receivable_sale: row.receivable_sale ?? 0,
        cq_in_transit: row.cq_in_transit ?? 0,
      })) as EnrichedBalanceRow[];
    },
    enabled: !!selectedDate,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Fetch summary using optimized RPC - much faster than client-side aggregation
  const { data: summary } = useQuery({
    queryKey: ['balances-summary', selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined, previewAsRM],
    queryFn: async () => {
      if (!selectedDate) return null;
      
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const rmEmail = previewAsRM && previewAsRM !== 'all' ? previewAsRM : null;
      
      const { data, error } = await supabase.rpc('get_admin_balances_summary', {
        p_date: dateStr,
        p_rm_email: rmEmail,
      });
      
      if (error) throw error;
      
      const row = data?.[0];
      return row ? {
        total_clients: Number(row.total_clients) || 0,
        total_mv_sum: Number(row.total_mv_sum) || 0,
        total_cost_sum: Number(row.total_cost_sum) || 0,
        unrealized_pnl_sum: Number(row.unrealized_pnl_sum) || 0,
        negative_ledger_clients_count: Number(row.negative_ledger_count) || 0,
        receivable_sum: Number(row.receivable_sum) || 0,
        cq_sum: Number(row.cq_sum) || 0,
        total_accrued_interest: Number(row.total_accrued_interest) || 0,
        total_margin_loan: Number(row.total_margin_loan) || 0,
        total_brokerage: Number(row.total_brokerage) || 0,
      } : {
        total_clients: 0,
        total_mv_sum: 0,
        total_cost_sum: 0,
        unrealized_pnl_sum: 0,
        negative_ledger_clients_count: 0,
        receivable_sum: 0,
        cq_sum: 0,
        total_accrued_interest: 0,
        total_margin_loan: 0,
        total_brokerage: 0,
      };
    },
    enabled: !!selectedDate,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch portfolios for grouping
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-for-balance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, description, investor_code');
      if (error) throw error;
      return data as Portfolio[];
    },
  });

  // Fetch employee department data for brokerage breakdown
  const { data: employeeDepartments } = useQuery({
    queryKey: ['employee-departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('email, department');
      if (error) throw error;
      return data || [];
    },
  });

  // Create email to department map
  const emailToDepartmentMap = useMemo(() => {
    const map: Record<string, string> = {};
    employeeDepartments?.forEach(emp => {
      if (emp.email && emp.department) {
        map[emp.email.toLowerCase()] = emp.department;
      }
    });
    return map;
  }, [employeeDepartments]);

  // Calculate brokerage commission by department
  const brokerageByDepartment = useMemo(() => {
    const deptMap: Record<string, { total: number; count: number }> = {};
    let totalBrokerage = 0;

    const investorBrokerage: Record<string, { brokerage: number; rmEmail: string | null }> = {};
    
    enrichedData?.forEach(row => {
      if (!investorBrokerage[row.investor_code]) {
        investorBrokerage[row.investor_code] = {
          brokerage: row.brokerage_amount || 0,
          rmEmail: row.rm_email,
        };
      }
    });

    Object.values(investorBrokerage).forEach(({ brokerage, rmEmail }) => {
      const department = rmEmail ? emailToDepartmentMap[rmEmail.toLowerCase()] : null;
      const deptName = department || 'Unassigned';
      
      if (!deptMap[deptName]) {
        deptMap[deptName] = { total: 0, count: 0 };
      }
      deptMap[deptName].total += brokerage;
      deptMap[deptName].count += 1;
      totalBrokerage += brokerage;
    });

    const departments = Object.entries(deptMap)
      .map(([name, data]) => ({
        name,
        total: data.total,
        count: data.count,
        percentage: totalBrokerage > 0 ? (data.total / totalBrokerage) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return { departments, totalBrokerage };
  }, [enrichedData, emailToDepartmentMap]);

  // Apply filters
  const filteredData = useMemo(() => {
    if (!enrichedData) return [];
    const query = searchQuery.trim().toLowerCase();

    return enrichedData.filter(row => {
      const matchesSearch = query === '' ||
        row.investor_code.toLowerCase() === query ||
        (row.instrument?.toLowerCase().includes(query) ?? false);
      const matchesRisk = riskFilter === 'all' || row.risk_flag === riskFilter;
      const matchesNegative = !onlyNegativeLedger || row.adjusted_ledger < 0;
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

  // Virtual scrolling for the main table
  const rowVirtualizer = useVirtualizer({
    count: sortedData.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Group by investor
  const investorGroups = useMemo(() => {
    return groupByInvestor(filteredData);
  }, [filteredData]);

  // Group by instrument for second tab
  const instrumentSummary = useMemo(() => {
    return groupByInstrument(enrichedData || []);
  }, [enrichedData]);

  // Group by portfolio for third tab
  const portfolioSummary = useMemo(() => {
    if (!portfolios || !enrichedData) return [];
    return groupByPortfolio(enrichedData, portfolios);
  }, [enrichedData, portfolios]);

  // Group by RM for fourth tab
  const rmSummary = useMemo(() => {
    if (!portfolios || !enrichedData) return [];
    return groupByRM(enrichedData, portfolios);
  }, [enrichedData, portfolios]);

  const filteredPortfolioSummary = useMemo(() => {
    const queryRaw = portfolioSearchQuery.trim();
    if (!queryRaw) return portfolioSummary;

    const query = queryRaw.toLowerCase();
    const isNumericQuery = /^\d+$/.test(queryRaw);

    return portfolioSummary.filter((p) => {
      if (isNumericQuery) {
        if (p.portfolio_name.toLowerCase() === query) return true;
        return p.investor_codes.some((code) => code.toLowerCase() === query);
      }
      if (p.portfolio_name.toLowerCase().includes(query)) return true;
      if (p.description?.toLowerCase().includes(query)) return true;
      if (p.investor_codes.some((code) => code.toLowerCase() === query)) return true;
      return false;
    });
  }, [portfolioSummary, portfolioSearchQuery]);

  const sortedPortfolioRows = useMemo(() => {
    return [...filteredPortfolioSummary].sort((a, b) => b.total_mv - a.total_mv);
  }, [filteredPortfolioSummary]);

  const filteredRMSummary = useMemo(() => {
    const queryRaw = rmSearchQuery.trim();
    if (!queryRaw) return rmSummary;

    const query = queryRaw.toLowerCase();

    return rmSummary.filter((rm) => {
      if (rm.rm_id.toLowerCase().includes(query)) return true;
      if (rm.rm_name?.toLowerCase().includes(query)) return true;
      if (rm.investor_codes.some((code) => code.toLowerCase() === query)) return true;
      if (rm.portfolio_names.some((name) => name.toLowerCase().includes(query))) return true;
      return false;
    });
  }, [rmSummary, rmSearchQuery]);

  const sortedRMRows = useMemo(() => {
    return [...filteredRMSummary].sort((a, b) => b.total_mv - a.total_mv);
  }, [filteredRMSummary]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
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
    queryClient.invalidateQueries({ queryKey: ['balances-enriched'] });
    queryClient.invalidateQueries({ queryKey: ['balances-summary'] });
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

  const summaryData = summary || {
    total_clients: 0,
    total_mv_sum: 0,
    total_cost_sum: 0,
    unrealized_pnl_sum: 0,
    negative_ledger_clients_count: 0,
    receivable_sum: 0,
    cq_sum: 0,
    total_accrued_interest: 0,
    total_margin_loan: 0,
  };

  if (error) {
    return (
      <MainLayout title="Admin Balances" subtitle="Balance data analysis">
        <div className="glass-card rounded-xl p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Error loading data</h3>
          <p className="text-muted-foreground mb-4">{error.message || 'An error occurred'}</p>
          <Button onClick={() => refetchBalances()} variant="outline">
            Retry Loading
          </Button>
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
        <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
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
                    // Disable future dates
                    if (date > new Date()) return true;
                    // Only allow dates that have data
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

          {/* RM Preview Selector */}
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm">Preview as RM</Label>
            <Select value={previewAsRM} onValueChange={setPreviewAsRM}>
              <SelectTrigger className="w-[280px] bg-secondary border-border">
                <SelectValue placeholder="All RMs (Admin View)" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">All RMs (Admin View)</SelectItem>
                {rmList?.map((rm) => (
                  <SelectItem key={rm.email} value={rm.email}>
                    {rm.name} ({rm.email.split('@')[0]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {previewAsRM && previewAsRM !== "all" && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPreviewAsRM("all")}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <ImportAdminBalanceDialog onSuccess={handleImportComplete} />
            <CopyBalancesDialog 
              availableDates={availableDates || []} 
              onCopyComplete={handleImportComplete} 
            />
          </div>
        </div>

        {/* RM Preview Banner */}
        {previewAsRM && previewAsRM !== "all" && (
          <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <span className="text-sm">
              Previewing as: <strong>{rmList?.find(r => r.email === previewAsRM)?.name || previewAsRM}</strong>
              {" "}— showing only data this RM would see when logged in
            </span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Investors</span>
            </div>
            <p className="text-xl font-semibold">{summaryData.total_clients}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Market Value</span>
            </div>
            <p className="text-xl font-semibold">{formatCurrency(summaryData.total_mv_sum)}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Cost</span>
            </div>
            <p className="text-xl font-semibold">{formatCurrency(summaryData.total_cost_sum)}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              {summaryData.unrealized_pnl_sum >= 0 ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className="text-xs text-muted-foreground">Unrealized P&L</span>
            </div>
            <p className={cn("text-xl font-semibold", summaryData.unrealized_pnl_sum >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(summaryData.unrealized_pnl_sum)}
            </p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Negative Ledger</span>
            </div>
            <p className="text-xl font-semibold text-destructive">{summaryData.negative_ledger_clients_count}</p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Receivables</span>
            </div>
            <p className="text-xl font-semibold text-amber-400">
              {formatCurrency(summaryData.receivable_sum + summaryData.cq_sum)}
            </p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-orange-400" />
              <span className="text-xs text-muted-foreground">Accrued Interest</span>
            </div>
            <p className="text-xl font-semibold text-orange-400">
              {formatCurrency(summaryData.total_accrued_interest)}
            </p>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Margin Loan</span>
            </div>
            <p className="text-xl font-semibold text-red-400">
              {formatCurrency(summaryData.total_margin_loan)}
            </p>
          </div>
        </div>

        {/* Brokerage Commission by Department Card */}
        <div className="glass-card rounded-xl p-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Percent className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Brokerage Commission by Department</span>
            <span className="text-xs text-muted-foreground ml-auto">
              Total: {formatCurrency(brokerageByDepartment.totalBrokerage)}
            </span>
          </div>
          {brokerageByDepartment.departments.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {brokerageByDepartment.departments.slice(0, 12).map((dept) => (
                <div key={dept.name} className="bg-secondary/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground truncate mb-1" title={dept.name}>
                    {dept.name}
                  </p>
                  <p className="text-sm font-semibold text-primary">
                    {formatCurrency(dept.total)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dept.percentage.toFixed(1)}% • {dept.count} clients
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No brokerage data available</p>
          )}
          {brokerageByDepartment.departments.length > 12 && (
            <p className="text-xs text-muted-foreground mt-2">
              +{brokerageByDepartment.departments.length - 12} more departments
            </p>
          )}
        </div>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Holdings ({sortedData.length.toLocaleString()})</TabsTrigger>
          <TabsTrigger value="comp-view">Comp View ({investorGroups.length.toLocaleString()})</TabsTrigger>
          <TabsTrigger value="by-instrument">By Instrument</TabsTrigger>
          <TabsTrigger value="by-portfolio">By Portfolio</TabsTrigger>
          <TabsTrigger value="by-rm">By RM</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {/* Filters Panel */}
          <div className="flex flex-wrap items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search investor code or instrument..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>

            <Select value={riskFilter} onValueChange={setRiskFilter}>
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
                onCheckedChange={setOnlyNegativeLedger}
              />
              <Label htmlFor="negative" className="text-sm cursor-pointer">Negative ledger</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch 
                id="receivables" 
                checked={onlyReceivables} 
                onCheckedChange={setOnlyReceivables}
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
                <p className="text-muted-foreground">
                  Loading balance data...
                  {loadingProgress.batchNumber > 0 && (
                    <span className="block text-sm mt-1">
                      Batch {loadingProgress.batchNumber} • {loadingProgress.loaded.toLocaleString()} rows loaded
                    </span>
                  )}
                </p>
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
                      <TableHead className="text-muted-foreground text-right">Ledger</TableHead>
                      <TableHead className="text-muted-foreground text-right">Deposits</TableHead>
                      <TableHead className="text-muted-foreground text-right">Withdraw</TableHead>
                      <TableHead className="text-muted-foreground text-right">Net Buy</TableHead>
                      <TableHead className="text-muted-foreground text-right">Net Sell</TableHead>
                      <TableHead className="text-muted-foreground text-right">Adj. Ledger</TableHead>
                      <TableHead className="text-muted-foreground text-right">Accrued Int.</TableHead>
                      <TableHead className="text-muted-foreground text-right">Recv/Pay</TableHead>
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
                          <TableCell className={cn("text-right", group.deposits > 0 && "text-success")}>
                            {formatNumber(group.deposits)}
                          </TableCell>
                          <TableCell className={cn("text-right", group.withdrawals > 0 && "text-destructive")}>
                            {formatNumber(group.withdrawals)}
                          </TableCell>
                          <TableCell className={cn("text-right", group.net_buy > 0 ? "text-destructive" : group.net_buy < 0 ? "text-success" : "")}>
                            {formatNumber(group.net_buy)}
                          </TableCell>
                          <TableCell className={cn("text-right", group.net_sell >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(group.net_sell)}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", group.adjusted_ledger < 0 ? "text-destructive" : "text-success")}>
                            {formatNumber(group.adjusted_ledger)}
                          </TableCell>
                          <TableCell className={cn("text-right", group.accrued_interest > 0 && "text-amber-400")}>
                            {group.accrued_interest > 0 ? formatNumber(group.accrued_interest) : '—'}
                          </TableCell>
                          <TableCell className={cn("text-right", group.receivable_payable >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(group.receivable_payable)}
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
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
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
              // Flat view with virtual scrolling
              <div 
                ref={tableContainerRef}
                className="overflow-auto max-h-[600px]"
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-secondary">
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
                      <SortableHeader field="deposits" className="text-right">Deposits</SortableHeader>
                      <SortableHeader field="withdrawals" className="text-right">Withdraw</SortableHeader>
                      <SortableHeader field="net_buy" className="text-right">Net Buy</SortableHeader>
                      <SortableHeader field="net_sell" className="text-right">Net Sell</SortableHeader>
                      <SortableHeader field="adjusted_ledger" className="text-right">Adj. Ledger</SortableHeader>
                      <SortableHeader field="accrued_interest" className="text-right">Accrued Int.</SortableHeader>
                      <SortableHeader field="receivable_payable" className="text-right">Recv/Pay</SortableHeader>
                      <SortableHeader field="risk_flag">Risk</SortableHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }} />
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const row = sortedData[virtualRow.index];
                      return (
                        <TableRow 
                          key={row.id} 
                          className={cn(
                            "border-border",
                            row.risk_flag === 'High' && "bg-destructive/10 hover:bg-destructive/15",
                            row.risk_flag === 'Watch' && "bg-amber-500/10 hover:bg-amber-500/15"
                          )}
                          style={{ height: `${ROW_HEIGHT}px` }}
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
                          <TableCell className={cn("text-right", row.deposits > 0 && "text-success")}>
                            {formatNumber(row.deposits)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.withdrawals > 0 && "text-destructive")}>
                            {formatNumber(row.withdrawals)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.net_buy > 0 ? "text-destructive" : row.net_buy < 0 ? "text-success" : "")}>
                            {formatNumber(row.net_buy)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.net_sell >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(row.net_sell)}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", row.adjusted_ledger < 0 ? "text-destructive" : "text-success")}>
                            {formatNumber(row.adjusted_ledger)}
                          </TableCell>
                          <TableCell className={cn("text-right", row.accrued_interest > 0 && "text-amber-400")}>
                            {row.accrued_interest > 0 ? formatNumber(row.accrued_interest) : '—'}
                          </TableCell>
                          <TableCell className={cn("text-right", row.receivable_payable >= 0 ? "text-success" : "text-destructive")}>
                            {formatNumber(row.receivable_payable)}
                          </TableCell>
                          <TableCell>{getRiskBadge(row.risk_flag)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <tr style={{ height: `${rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end ?? 0)}px` }} />
                  </TableBody>
                </Table>
              </div>
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
                  {instrumentSummary.map((inst) => (
                    <TableRow key={inst.instrument} className="border-border">
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
                      <TableCell className="text-right">{inst.investor_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="by-portfolio" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search portfolio name or investor code..."
                value={portfolioSearchQuery}
                onChange={(e) => setPortfolioSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">Portfolio</TableHead>
                    <TableHead className="text-muted-foreground">Description</TableHead>
                    <TableHead className="text-muted-foreground text-right">Investors</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Negative Ledger</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPortfolioRows.map((port) => (
                    <TableRow 
                      key={port.portfolio_id} 
                      className={cn(
                        "border-border",
                        port.high_risk_count > 0 && "bg-destructive/10",
                        port.high_risk_count === 0 && port.watch_risk_count > 0 && "bg-amber-500/10"
                      )}
                    >
                      <TableCell className="font-medium">{port.portfolio_name}</TableCell>
                      <TableCell className="text-muted-foreground">{port.description || '—'}</TableCell>
                      <TableCell className="text-right">{port.investor_count}</TableCell>
                      <TableCell className="text-right">{formatNumber(port.total_cost)}</TableCell>
                      <TableCell className="text-right">{formatNumber(port.total_mv)}</TableCell>
                      <TableCell className={cn("text-right", port.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                        {formatNumber(port.unrealized_pnl)}
                      </TableCell>
                      <TableCell className={cn("text-right", (port.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                        {formatPercent(port.pnl_pct)}
                      </TableCell>
                      <TableCell className={cn("text-right", port.negative_ledger_count > 0 && "text-destructive")}>
                        {port.negative_ledger_count}
                      </TableCell>
                      <TableCell>
                        {port.high_risk_count > 0 ? (
                          <Badge variant="destructive">{port.high_risk_count} High</Badge>
                        ) : port.watch_risk_count > 0 ? (
                          <Badge className="bg-amber-500/20 text-amber-400">{port.watch_risk_count} Watch</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comp-view" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search investor code..."
                value={compSearchQuery}
                onChange={(e) => setCompSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">Investor</TableHead>
                    <TableHead className="text-muted-foreground text-right">Holdings</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unreal. P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Ledger</TableHead>
                    <TableHead className="text-muted-foreground text-right">Deposits</TableHead>
                    <TableHead className="text-muted-foreground text-right">Withdrawals</TableHead>
                    <TableHead className="text-muted-foreground text-right">Net Buy</TableHead>
                    <TableHead className="text-muted-foreground text-right">Net Sell</TableHead>
                    <TableHead className="text-muted-foreground text-right">Adj. Ledger</TableHead>
                    <TableHead className="text-muted-foreground text-right">Accrued Int.</TableHead>
                    <TableHead className="text-muted-foreground text-right">Recv/Pay</TableHead>
                    <TableHead className="text-muted-foreground text-right">Brokerage</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {investorGroups
                    .filter(group => {
                      if (!compSearchQuery.trim()) return true;
                      return group.investor_code.toLowerCase().includes(compSearchQuery.toLowerCase());
                    })
                    .sort((a, b) => b.total_mv - a.total_mv)
                    .map((group) => (
                    <TableRow 
                      key={group.investor_code} 
                      className={cn(
                        "border-border",
                        group.risk_flag === 'High' && "bg-destructive/10",
                        group.risk_flag === 'Watch' && "bg-amber-500/10"
                      )}
                    >
                      <TableCell className="font-medium">{group.investor_code}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{group.instruments.length}</TableCell>
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
                      <TableCell className="text-right text-success">{formatNumber(group.deposits)}</TableCell>
                      <TableCell className="text-right text-destructive">{formatNumber(group.withdrawals)}</TableCell>
                      <TableCell className="text-right text-amber-400">{formatNumber(group.net_buy)}</TableCell>
                      <TableCell className="text-right text-sky-400">{formatNumber(group.net_sell)}</TableCell>
                      <TableCell className={cn("text-right font-medium", group.adjusted_ledger < 0 && "text-destructive")}>
                        {formatNumber(group.adjusted_ledger)}
                      </TableCell>
                      <TableCell className="text-right text-orange-400">{formatNumber(group.accrued_interest)}</TableCell>
                      <TableCell className={cn("text-right", group.receivable_payable >= 0 ? "text-amber-400" : "text-sky-400")}>
                        {formatNumber(group.receivable_payable)}
                      </TableCell>
                      <TableCell className="text-right text-primary">{formatNumber(group.brokerage_amount)}</TableCell>
                      <TableCell>{getRiskBadge(group.risk_flag)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="by-rm" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search RM name, ID, or investor code..."
                value={rmSearchQuery}
                onChange={(e) => setRMSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">RM</TableHead>
                    <TableHead className="text-muted-foreground">Name</TableHead>
                    <TableHead className="text-muted-foreground text-right">Investors</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Negative Ledger</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRMRows.map((rm) => (
                    <TableRow 
                      key={rm.rm_id} 
                      className={cn(
                        "border-border",
                        rm.high_risk_count > 0 && "bg-destructive/10",
                        rm.high_risk_count === 0 && rm.watch_risk_count > 0 && "bg-amber-500/10"
                      )}
                    >
                      <TableCell className="font-medium">{rm.rm_id}</TableCell>
                      <TableCell className="text-muted-foreground">{rm.rm_name || '—'}</TableCell>
                      <TableCell className="text-right">{rm.investor_count}</TableCell>
                      <TableCell className="text-right">{formatNumber(rm.total_cost)}</TableCell>
                      <TableCell className="text-right">{formatNumber(rm.total_mv)}</TableCell>
                      <TableCell className={cn("text-right", rm.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                        {formatNumber(rm.unrealized_pnl)}
                      </TableCell>
                      <TableCell className={cn("text-right", (rm.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                        {formatPercent(rm.pnl_pct)}
                      </TableCell>
                      <TableCell className={cn("text-right", rm.negative_ledger_count > 0 && "text-destructive")}>
                        {rm.negative_ledger_count}
                      </TableCell>
                      <TableCell>
                        {rm.high_risk_count > 0 ? (
                          <Badge variant="destructive">{rm.high_risk_count} High</Badge>
                        ) : rm.watch_risk_count > 0 ? (
                          <Badge className="bg-amber-500/20 text-amber-400">{rm.watch_risk_count} Watch</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
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
