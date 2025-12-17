import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
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
import { format, parseISO, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  BalanceRawRow,
  EnrichedBalanceRow,
  Portfolio,
  InvestorAdjustment,
  InvestorData,
  enrichBalanceRow,
  calculateSummary,
  groupByInvestor,
  groupByInstrument,
  groupByPortfolio,
  groupByRM,
  formatCurrency,
  formatNumber,
  formatPercent,
  InvestorGroupedRow,
  InstrumentSummary,
  PortfolioSummary,
  RMSummary,
} from "@/lib/balance-utils";

type SortField = 'investor_code' | 'instrument' | 'total_stock' | 'saleable' | 'avg_cost' | 'total_cost' | 'total_mv' | 'unrealized_pnl' | 'pnl_pct' | 'ledger_balance' | 'adjusted_ledger' | 'deposits' | 'withdrawals' | 'net_sell' | 'net_buy' | 'matured_balance' | 'receivable_sale' | 'cq_in_transit' | 'net_available' | 'risk_flag' | 'accrued_interest' | 'receivable_payable';
type SortDirection = 'asc' | 'desc';

const ROWS_PER_PAGE = 50;

const AdminBalancesPage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [portfolioSearchQuery, setPortfolioSearchQuery] = useState("");
  const [rmSearchQuery, setRMSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [onlyNegativeLedger, setOnlyNegativeLedger] = useState(false);
  const [onlyReceivables, setOnlyReceivables] = useState(false);
  const [groupByInvestorView, setGroupByInvestorView] = useState(false);
  const [expandedInvestors, setExpandedInvestors] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('investor_code');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, isLoading: false });

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

  // Helper function to fetch balance data for a specific date (used for prefetching)
  // Uses keyset pagination (no OFFSET) to avoid timeouts on large datasets.
  const fetchBalanceData = useCallback(async (dateStr: string): Promise<BalanceRawRow[]> => {
    let allData: BalanceRawRow[] = [];
    const batchSize = 1000;
    const maxRetries = 3;

    let lastId: string | null = null;

    while (true) {
      let lastError: Error | null = null;
      let data: BalanceRawRow[] | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          let query = supabase
            .from('balances_raw')
            .select('*')
            .eq('as_of_date', dateStr)
            .order('id', { ascending: true })
            .limit(batchSize);

          if (lastId) query = query.gt('id', lastId);

          const result = await query;

          if (result.error) {
            lastError = new Error(result.error.message);
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
            }
            continue;
          }

          data = result.data as BalanceRawRow[];
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Unknown error');
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
          }
        }
      }

      if (lastError) throw lastError;
      if (!data || data.length === 0) break;

      allData = [...allData, ...data];

      if (data.length < batchSize) break;
      lastId = data[data.length - 1]?.id ?? null;
      if (!lastId) break;
    }

    return allData;
  }, []);

  // Fetch raw balance data for selected date with retry logic
  // Uses keyset pagination (no OFFSET) to avoid timeouts on large datasets.
  const { data: rawBalances, isLoading, error, refetch: refetchBalances } = useQuery({
    queryKey: ['balances-raw', selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined],
    queryFn: async () => {
      if (!selectedDate) return [];

      setLoadingProgress({ loaded: 0, isLoading: true });

      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      let allData: BalanceRawRow[] = [];
      const batchSize = 1000;
      const maxRetries = 3;

      let lastId: string | null = null;

      while (true) {
        let lastError: Error | null = null;
        let data: BalanceRawRow[] | null = null;

        // Retry logic for each batch
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            let query = supabase
              .from('balances_raw')
              .select('*')
              .eq('as_of_date', dateStr)
              .order('id', { ascending: true })
              .limit(batchSize);

            if (lastId) query = query.gt('id', lastId);

            const result = await query;

            if (result.error) {
              lastError = new Error(result.error.message);
              if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
              }
              continue;
            }

            data = result.data as BalanceRawRow[];
            lastError = null;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error('Unknown error');
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
            }
          }
        }

        if (lastError) {
          setLoadingProgress({ loaded: allData.length, isLoading: false });
          throw lastError;
        }
        if (!data || data.length === 0) break;

        allData = [...allData, ...data];
        setLoadingProgress({ loaded: allData.length, isLoading: true });

        if (data.length < batchSize) break;
        lastId = data[data.length - 1]?.id ?? null;
        if (!lastId) break;
      }

      setLoadingProgress({ loaded: allData.length, isLoading: false });
      return allData;
    },
    enabled: !!selectedDate,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Prefetch adjacent dates in background after current data loads
  useEffect(() => {
    if (!rawBalances || !availableDates || availableDates.length === 0 || !selectedDate) return;

    // Avoid heavy background work when the current date dataset is large
    if (rawBalances.length > 15000) return;

    const currentDateStr = format(selectedDate, 'yyyy-MM-dd');
    const currentIndex = availableDates.indexOf(currentDateStr);

    // Prefetch just the nearest previous + next dates (common navigation)
    const datesToPrefetch: string[] = [];
    if (currentIndex > 0) datesToPrefetch.push(availableDates[currentIndex - 1]);
    if (currentIndex < availableDates.length - 1) datesToPrefetch.push(availableDates[currentIndex + 1]);

    const timeouts: number[] = [];

    datesToPrefetch.forEach((dateStr, index) => {
      const t = window.setTimeout(() => {
        queryClient.prefetchQuery({
          queryKey: ['balances-raw', dateStr],
          queryFn: () => fetchBalanceData(dateStr),
          staleTime: 5 * 60 * 1000,
        });
      }, (index + 1) * 4000); // stagger more gently

      timeouts.push(t);
    });

    return () => {
      timeouts.forEach(t => window.clearTimeout(t));
    };
  }, [rawBalances, availableDates, selectedDate, queryClient, fetchBalanceData]);

  // Fetch next day's deposits/withdrawals
  const { data: nextDayTransactions } = useQuery({
    queryKey: ['next-day-transactions', selectedDate?.toISOString()],
    queryFn: async () => {
      if (!selectedDate) return [];
      const nextDay = addDays(selectedDate, 1);
      const nextDayStr = format(nextDay, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('deposits_withdrawals')
        .select('investor_code, transaction_type, amount')
        .eq('transaction_date', nextDayStr);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedDate,
  });

  // Fetch securities for category lookup (DSE settlement rules)
  const { data: securities } = useQuery({
    queryKey: ['securities-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('securities')
        .select('trading_code, category');
      if (error) throw error;
      return data || [];
    },
  });

  // Create category lookup map
  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    securities?.forEach(sec => {
      if (sec.trading_code) {
        map[sec.trading_code.toUpperCase()] = sec.category?.toUpperCase() || '';
      }
    });
    return map;
  }, [securities]);

  // Fetch latest trade date from trade_history
  const { data: latestTradeDate } = useQuery({
    queryKey: ['latest-trade-date'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_history')
        .select('trade_date')
        .not('trade_date', 'is', null)
        .order('trade_date', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      return data?.[0]?.trade_date || null;
    },
  });

  // DSE Settlement Rules: Use latest trade date for calculations
  // Fetch all trades from the latest trade date
  const { data: maturedTrades, isLoading: tradesLoading } = useQuery({
    queryKey: ['matured-trades', latestTradeDate],
    queryFn: async () => {
      if (!latestTradeDate) return [];
      
      console.log('Fetching trades for latest trade date:', latestTradeDate);
      
      // Fetch all trades from the latest trade date
      const { data, error } = await supabase
        .from('trade_history')
        .select('client_code, side, value, security_code, trade_date')
        .eq('trade_date', latestTradeDate);
      
      if (error) throw error;
      console.log('Trades found for latest date:', data?.length || 0);
      return data || [];
    },
    enabled: !!latestTradeDate,
  });

  // Calculate adjustments per investor from next day's data and latest trades
  const investorAdjustments = useMemo(() => {
    const adjustments: Record<string, InvestorAdjustment> = {};
    
    // Process transactions (deposits/withdrawals)
    nextDayTransactions?.forEach(tx => {
      if (!adjustments[tx.investor_code]) {
        adjustments[tx.investor_code] = { deposits: 0, withdrawals: 0, net_sell: 0, net_buy: 0 };
      }
      if (tx.transaction_type === 'Deposit') {
        adjustments[tx.investor_code].deposits += Number(tx.amount) || 0;
      } else if (tx.transaction_type === 'Withdrawal') {
        adjustments[tx.investor_code].withdrawals += Number(tx.amount) || 0;
      }
    });
    
    // Process all trades from the latest trade date
    maturedTrades?.forEach(trade => {
      const clientCode = trade.client_code;
      if (!clientCode) return;
      
      if (!adjustments[clientCode]) {
        adjustments[clientCode] = { deposits: 0, withdrawals: 0, net_sell: 0, net_buy: 0 };
      }
      
      const value = Number(trade.value) || 0;
      if (trade.side?.toUpperCase() === 'SELL' || trade.side?.toUpperCase() === 'S') {
        adjustments[clientCode].net_sell += value;
        adjustments[clientCode].net_buy -= value;
      } else if (trade.side?.toUpperCase() === 'BUY' || trade.side?.toUpperCase() === 'B') {
        adjustments[clientCode].net_sell -= value;
        adjustments[clientCode].net_buy += value;
      }
    });
    
    return adjustments;
  }, [nextDayTransactions, maturedTrades]);

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

  // Fetch investor data for accrued interest and brokerage commission calculations
  const { data: investorData } = useQuery({
    queryKey: ['investor-data-for-balance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investors')
        .select('investor_code, interest_rate, brokerage_commission, account_type');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Create investor data map for quick lookup
  const investorDataMap = useMemo(() => {
    const map: Record<string, InvestorData> = {};
    investorData?.forEach(inv => {
      map[inv.investor_code] = {
        interest_rate: Number(inv.interest_rate) || 0,
        brokerage_commission: Number(inv.brokerage_commission) || 0,
        account_type: inv.account_type,
      };
    });
    return map;
  }, [investorData]);

  // Enrich data with computed fields including next-day adjustments
  const enrichedData = useMemo(() => {
    if (!rawBalances) return [];
    return rawBalances.map(row => enrichBalanceRow(row, investorAdjustments, investorDataMap));
  }, [rawBalances, investorAdjustments, investorDataMap]);

  // Calculate summary
  const summary = useMemo(() => {
    return calculateSummary(enrichedData);
  }, [enrichedData]);

  // Apply filters
  const filteredData = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return enrichedData.filter(row => {
      // Search filter
      // - investor_code: exact match only
      // - instrument: partial match
      const matchesSearch = query === '' ||
        row.investor_code.toLowerCase() === query ||
        (row.instrument?.toLowerCase().includes(query) ?? false);

      // Risk filter
      const matchesRisk = riskFilter === 'all' || row.risk_flag === riskFilter;

      // Negative ledger filter (uses adjusted_ledger now)
      const matchesNegative = !onlyNegativeLedger || row.adjusted_ledger < 0;

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

  // Group by portfolio for third tab
  const portfolioSummary = useMemo(() => {
    if (!portfolios) return [];
    return groupByPortfolio(enrichedData, portfolios);
  }, [enrichedData, portfolios]);

  // Group by RM for fourth tab
  const rmSummary = useMemo(() => {
    if (!portfolios) return [];
    return groupByRM(enrichedData, portfolios);
  }, [enrichedData, portfolios]);

  const filteredPortfolioSummary = useMemo(() => {
    const queryRaw = portfolioSearchQuery.trim();
    if (!queryRaw) return portfolioSummary;

    const query = queryRaw.toLowerCase();
    const isNumericQuery = /^\d+$/.test(queryRaw);

    return portfolioSummary.filter((p) => {
      if (isNumericQuery) {
        // Numeric searches should match codes exactly (prevents 3008 matching 13008 / OBO3008)
        if (p.portfolio_name.toLowerCase() === query) return true;
        return p.investor_codes.some((code) => code.toLowerCase() === query);
      }

      // Text searches: partial match on name/description, exact match on codes
      if (p.portfolio_name.toLowerCase().includes(query)) return true;
      if (p.description?.toLowerCase().includes(query)) return true;
      if (p.investor_codes.some((code) => code.toLowerCase() === query)) return true;
      return false;
    });
  }, [portfolioSummary, portfolioSearchQuery]);

  const sortedPortfolioRows = useMemo(() => {
    return [...filteredPortfolioSummary].sort((a, b) => b.total_mv - a.total_mv);
  }, [filteredPortfolioSummary]);

  // Filter RM summary
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
          <p className="text-muted-foreground mb-4">{error.message || 'An error occurred'}</p>
          <Button onClick={() => refetchBalances()} variant="outline">
            Retry Loading
          </Button>
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
                <p className="text-muted-foreground mb-3">Loading balance data...</p>
                <div className="max-w-xs mx-auto space-y-2">
                  <Progress value={loadingProgress.loaded > 0 ? Math.min((loadingProgress.loaded / 25000) * 100, 95) : 5} className="h-2" />
                  <p className="text-sm font-medium text-foreground">
                    {loadingProgress.loaded.toLocaleString()} records loaded
                  </p>
                </div>
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
                        <SortableHeader field="deposits" className="text-right">Deposits</SortableHeader>
                        <SortableHeader field="withdrawals" className="text-right">Withdraw</SortableHeader>
                        <SortableHeader field="net_buy" className="text-right">Net Buy</SortableHeader>
                        <SortableHeader field="net_sell" className="text-right">Net Sell</SortableHeader>
                        <SortableHeader field="adjusted_ledger" className="text-right">Adj. Ledger</SortableHeader>
                        <SortableHeader field="accrued_interest" className="text-right">Accrued Int.</SortableHeader>
                        <SortableHeader field="receivable_payable" className="text-right">Recv/Pay</SortableHeader>
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

        <TabsContent value="by-portfolio" className="space-y-4">
          {/* Search filter for portfolios */}
          <div className="flex items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search portfolio name, description, or investor code (exact)..."
                value={portfolioSearchQuery}
                onChange={(e) => setPortfolioSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {sortedPortfolioRows.length} portfolios
            </span>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">Portfolio</TableHead>
                    <TableHead className="text-muted-foreground">Description</TableHead>
                    <TableHead className="text-muted-foreground text-right">Investors</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Qty</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Ledger Balance</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPortfolioRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No portfolios found with balance data
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedPortfolioRows.map((portfolio) => (
                      <TableRow
                        key={portfolio.portfolio_id}
                        className={cn(
                          "border-border hover:bg-secondary/30",
                          portfolio.risk_flag === 'High' && "bg-destructive/10",
                          portfolio.risk_flag === 'Watch' && "bg-amber-500/10"
                        )}
                      >
                        <TableCell className="font-medium">{portfolio.portfolio_name}</TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">
                          {portfolio.description || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{portfolio.investor_count}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{portfolio.total_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatNumber(portfolio.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatNumber(portfolio.total_mv)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right",
                            portfolio.unrealized_pnl >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatNumber(portfolio.unrealized_pnl)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right",
                            (portfolio.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatPercent(portfolio.pnl_pct)}
                        </TableCell>
                        <TableCell className={cn("text-right", portfolio.ledger_balance < 0 && "text-destructive")}>
                          {formatNumber(portfolio.ledger_balance)}
                        </TableCell>
                        <TableCell>{getRiskBadge(portfolio.risk_flag)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="by-rm" className="space-y-4">
          {/* Search filter for RMs */}
          <div className="flex items-center gap-4 p-4 glass-card rounded-xl">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search RM name, ID, investor code, or portfolio..."
                value={rmSearchQuery}
                onChange={(e) => setRMSearchQuery(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {sortedRMRows.length} RMs
            </span>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-muted-foreground">RM ID</TableHead>
                    <TableHead className="text-muted-foreground">RM Name</TableHead>
                    <TableHead className="text-muted-foreground text-right">Investors</TableHead>
                    <TableHead className="text-muted-foreground text-right">Portfolios</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Qty</TableHead>
                    <TableHead className="text-muted-foreground text-right">Total Cost</TableHead>
                    <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Unrealized P&L</TableHead>
                    <TableHead className="text-muted-foreground text-right">P&L %</TableHead>
                    <TableHead className="text-muted-foreground text-right">Ledger Balance</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRMRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        No RM data found
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedRMRows.map((rm) => (
                      <TableRow
                        key={rm.rm_id}
                        className={cn(
                          "border-border hover:bg-secondary/30",
                          rm.risk_flag === 'High' && "bg-destructive/10",
                          rm.risk_flag === 'Watch' && "bg-amber-500/10"
                        )}
                      >
                        <TableCell className="font-mono text-sm">{rm.rm_id}</TableCell>
                        <TableCell className="font-medium">{rm.rm_name || '—'}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{rm.investor_count}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{rm.portfolio_count}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{rm.total_qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatNumber(rm.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatNumber(rm.total_mv)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right",
                            rm.unrealized_pnl >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatNumber(rm.unrealized_pnl)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right",
                            (rm.pnl_pct ?? 0) >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatPercent(rm.pnl_pct)}
                        </TableCell>
                        <TableCell className={cn("text-right", rm.ledger_balance < 0 && "text-destructive")}>
                          {formatNumber(rm.ledger_balance)}
                        </TableCell>
                        <TableCell>{getRiskBadge(rm.risk_flag)}</TableCell>
                      </TableRow>
                    ))
                  )}
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
