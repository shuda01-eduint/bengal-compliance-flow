import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { Search, Download, Wallet, TrendingUp, TrendingDown, Percent, Users, Plus, X, Settings, CalendarIcon, ArrowRight, FileText, ArrowDownToLine, ArrowUpFromLine, Eye, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Calculator, DollarSign, ArrowDownRight, ArrowUpRight, Award, ArrowUpDown, GripVertical, AlertTriangle, RefreshCw, Link as LinkIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { DepartmentTurnoverGrid } from "./DepartmentTurnoverGrid";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/balance-utils";
import { toast } from "sonner";
import { AccountingReconciliationDialog } from "./AccountingReconciliationDialog";
import { TradeDetailsDialog } from "./TradeDetailsDialog";
import { useDebounce } from "@/hooks/useDebounce";
import { useUnmatchedStagingData, hasSignificantUnmatchedData } from "@/hooks/useUnmatchedStagingData";

export interface AccountingRow {
  investor_code: string;
  investor_name: string;
  account_type: string;
  rm_name: string;
  department: string;
  interest_rate: number;
  brokerage_commission: number;
  ledger_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  net_buy: number;
  net_sell: number;
  adjusted_ledger: number;
  accrued_interest: number;
  receivable: number;
  payable: number;
  brokerage_amount: number;
  final_balance: number;
  gross_buy: number;
  gross_sell: number;
  [key: string]: string | number;
}

interface CustomField {
  id: string;
  name: string;
  formula: string;
}

interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  align?: 'left' | 'right';
  colorClass?: string;
}

const STORAGE_KEY = 'accounting-custom-fields';
const COLUMNS_STORAGE_KEY = 'accounting-columns-config-v3';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'investor_code', label: 'Code', visible: true, align: 'left' },
  { id: 'investor_name', label: 'Name', visible: true, align: 'left' },
  { id: 'account_type', label: 'Account Type', visible: true, align: 'left' },
  { id: 'rm_name', label: 'RM', visible: true, align: 'left' },
  { id: 'department', label: 'Department', visible: true, align: 'left' },
  { id: 'ledger_balance', label: 'Opening Bal', visible: true, align: 'right' },
  { id: 'total_deposits', label: 'Deposits', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'total_withdrawals', label: 'Withdrawals', visible: true, align: 'right', colorClass: 'text-amber-400' },
  { id: 'gross_buy', label: 'Gross Buy', visible: true, align: 'right', colorClass: 'text-red-400' },
  { id: 'gross_sell', label: 'Gross Sell', visible: true, align: 'right', colorClass: 'text-green-400' },
  { id: 'brokerage_amount', label: 'Brokerage', visible: true, align: 'right', colorClass: 'text-purple-400' },
  { id: 'final_balance', label: 'Closing Balance', visible: true, align: 'right', colorClass: 'text-blue-400' },
];

const evaluateFormula = (formula: string, row: AccountingRow): number => {
  try {
    let expression = formula.toLowerCase();
    
    const fieldMap: Record<string, number> = {
      'ledger_balance': row.ledger_balance,
      'ledger': row.ledger_balance,
      'deposits': row.total_deposits,
      'total_deposits': row.total_deposits,
      'withdrawals': row.total_withdrawals,
      'total_withdrawals': row.total_withdrawals,
      'net_buy': row.net_buy,
      'net_sell': row.net_sell,
      'adjusted_ledger': row.adjusted_ledger,
      'adjusted': row.adjusted_ledger,
      'accrued_interest': row.accrued_interest,
      'interest': row.accrued_interest,
      'receivable': row.receivable,
      'payable': row.payable,
      'interest_rate': row.interest_rate,
      'rate': row.interest_rate,
      'brokerage_commission': row.brokerage_commission,
      'brokerage_amount': row.brokerage_amount,
      'final_balance': row.final_balance,
      'commission': row.brokerage_commission,
      'gross_buy': row.gross_buy,
      'gross_sell': row.gross_sell,
    };

    Object.entries(fieldMap).forEach(([key, value]) => {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      expression = expression.replace(regex, String(value || 0));
    });

    // Handle MAX function
    expression = expression.replace(/max\(([^,]+),\s*([^)]+)\)/gi, (_, a, b) => {
      return `Math.max(${a}, ${b})`;
    });

    // Handle MIN function
    expression = expression.replace(/min\(([^,]+),\s*([^)]+)\)/gi, (_, a, b) => {
      return `Math.min(${a}, ${b})`;
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

type ChartView = 'margin' | 'commission';

// Normalize a date to local midnight to avoid timezone issues with react-day-picker
const normalizeToLocalDate = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

// Component to show warning when there's unmatched staging data
const UnmatchedDataWarning = ({ selectedDate }: { selectedDate: Date }) => {
  const { data: unmatchedData, isLoading } = useUnmatchedStagingData(selectedDate);
  
  if (isLoading || !hasSignificantUnmatchedData(unmatchedData)) {
    return null;
  }

  const totalUnmatchedTrades = unmatchedData?.unmatched_trade_count || 0;
  const totalUnmatchedValue = unmatchedData?.unmatched_trade_value || 0;
  const sampleCodes = unmatchedData?.sample_codes?.slice(0, 5) || [];

  return (
    <Alert variant="warning" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>
            <strong>{totalUnmatchedTrades.toLocaleString()} trades</strong> ({formatCurrency(totalUnmatchedValue)}) from unregistered investor codes are not captured in EOD snapshots.
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0 border-amber-500/50 text-amber-400 hover:bg-amber-500/20">
            <a href="/investors">
              <Users className="h-4 w-4 mr-2" />
              Manage Investors
            </a>
          </Button>
        </div>
        {sampleCodes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Sample codes: {sampleCodes.join(', ')}{sampleCodes.length < totalUnmatchedTrades ? '...' : ''}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
};

const AccountingTab = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldFormula, setNewFieldFormula] = useState("");
  const [chartView, setChartView] = useState<ChartView>('commission');
  const [selectedInvestor, setSelectedInvestor] = useState<AccountingRow | null>(null);
  // Single EOD date selector
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [selectedTradeType, setSelectedTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [selectedTradeInvestor, setSelectedTradeInvestor] = useState<AccountingRow | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>("investor_code");
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [activityFilter, setActivityFilter] = useState<string>("with_trades");

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!roleData);
    };
    checkAdmin();
  }, []);

  // Initialize with latest EOD date on mount
  useEffect(() => {
    const fetchLatestEodDate = async () => {
      const { data } = await supabase
        .from('eod_run_history')
        .select('run_date')
        .eq('status', 'completed')
        .order('run_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data?.run_date) {
        setSelectedDate(parseISO(data.run_date));
      }
    };
    fetchLatestEodDate();
  }, []);

  // Debounce search term for server-side search
  const debouncedSearch = useDebounce(searchTerm, 300);

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

  // Load columns config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as ColumnConfig[];

      // Merge saved config with new defaults so newly-added columns (e.g. Closing Balance)
      // always appear without wiping the user's saved visibility/order.
      const defaultsById = new Map(DEFAULT_COLUMNS.map((c) => [c.id, c] as const));
      const seen = new Set<string>();
      const merged: ColumnConfig[] = [];

      parsed.forEach((c) => {
        const def = defaultsById.get(c.id);
        if (!def || seen.has(c.id)) return;
        merged.push({ ...def, visible: typeof c.visible === "boolean" ? c.visible : def.visible });
        seen.add(c.id);
      });

      DEFAULT_COLUMNS.forEach((def) => {
        if (!seen.has(def.id)) merged.push(def);
      });

      setColumns(merged);
    } catch {
      console.error('Failed to load columns config');
    }
  }, []);

  // Save custom fields to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customFields));
  }, [customFields]);

  // Save columns config to localStorage
  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  // Format date for queries
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  
  // Debug logging
  console.log('[AccountingTab] EOD Date:', selectedDateStr);

  // Check if EOD has been run for the selected date
  const { data: eodStatus, isLoading: loadingEodStatus } = useQuery({
    queryKey: ['eod-run-status', selectedDateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('eod_run_history')
        .select('id, run_date, clients_captured, status')
        .eq('run_date', selectedDateStr)
        .eq('status', 'completed')
        .maybeSingle();
      return data;
    },
  });

  const hasEodData = !!eodStatus;

  // Fetch FULL summary aggregates (with pagination to bypass 1000 row limit)
  const { data: summaryAggregates } = useQuery({
    queryKey: ['accounting-summary-aggregates', selectedDateStr],
    queryFn: async () => {
      // Use pagination to fetch ALL rows and aggregate them
      const PAGE_SIZE = 1000;
      let allData: { total_commission: number; gross_buy: number; gross_sell: number; department: string | null }[] = [];
      let page = 0;
      let hasMore = true;
      
      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        const { data, error } = await supabase
          .from('eod_ledger_snapshots')
          .select('total_commission, gross_buy, gross_sell, department')
          .eq('eod_date', selectedDateStr)
          .range(from, to);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          allData = [...allData, ...data];
        }
        
        hasMore = data?.length === PAGE_SIZE;
        page++;
      }
      
      // Calculate aggregates from full dataset
      let totalCommission = 0;
      let totalBuy = 0;
      let totalSell = 0;
      let clientsWithTrades = 0;
      const departments = new Set<string>();
      
      allData.forEach(row => {
        totalCommission += Number(row.total_commission) || 0;
        totalBuy += Number(row.gross_buy) || 0;
        totalSell += Number(row.gross_sell) || 0;
        if ((Number(row.gross_buy) || 0) > 0 || (Number(row.gross_sell) || 0) > 0) {
          clientsWithTrades++;
        }
        if (row.department) departments.add(row.department);
      });
      
      return {
        totalCommission,
        totalTurnover: totalBuy + totalSell,
        clientsWithTrades,
        uniqueDepartments: departments.size,
        totalRecords: allData.length,
      };
    },
    enabled: hasEodData,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch accounting data directly from eod_ledger_snapshots
  const { data: accountingResult, isLoading: loadingData, isError, error: queryError, refetch } = useQuery({
    queryKey: ['accounting-eod-snapshot', selectedDateStr, debouncedSearch, accountTypeFilter, activityFilter],
    queryFn: async () => {
      // Build query to eod_ledger_snapshots
      let query = supabase
        .from('eod_ledger_snapshots')
        .select(`
          investor_code,
          investor_name,
          account_type,
          rm_name,
          department,
          opening_balance,
          total_deposits,
          total_withdrawals,
          gross_buy,
          gross_sell,
          total_commission,
          closing_balance
        `)
        .eq('eod_date', selectedDateStr);

      // Apply search filter
      if (debouncedSearch) {
        query = query.or(`investor_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%,rm_name.ilike.%${debouncedSearch}%`);
      }

      // Apply account type filter
      if (accountTypeFilter && accountTypeFilter !== 'all') {
        query = query.eq('account_type', accountTypeFilter);
      }

      // Apply activity filter using explicit conditions that work with .eq()
      if (activityFilter === 'with_trades') {
        // Use .neq to find rows where at least one has value > 0
        // Alternative: use .gt with separate conditions combined
        query = query.or('gross_buy.gt.0,gross_sell.gt.0');
      } else if (activityFilter === 'no_trades') {
        // Both must be 0 or null
        query = query.or('gross_buy.is.null,gross_buy.eq.0').or('gross_sell.is.null,gross_sell.eq.0');
      }
      // 'all' - no additional filter

      // Order and limit
      query = query.order('investor_code').limit(1000);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: hasEodData, // Only fetch if EOD data exists
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch turnover by department from eod_ledger_snapshots
  const { data: departmentTurnover } = useQuery({
    queryKey: ['accounting-turnover-by-department', selectedDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('eod_ledger_snapshots')
        .select('department, gross_buy, gross_sell')
        .eq('eod_date', selectedDateStr);
      
      if (error) throw error;
      
      // Group by department
      const deptMap = new Map<string, { department: string; total_buy: number; total_sell: number; turnover: number }>();
      
      (data || []).forEach(row => {
        const dept = row.department || 'Unknown';
        const buy = Number(row.gross_buy) || 0;
        const sell = Number(row.gross_sell) || 0;
        const existing = deptMap.get(dept);
        
        if (existing) {
          existing.total_buy += buy;
          existing.total_sell += sell;
          existing.turnover += buy + sell;
        } else {
          deptMap.set(dept, {
            department: dept,
            total_buy: buy,
            total_sell: sell,
            turnover: buy + sell,
          });
        }
      });
      
      return Array.from(deptMap.values())
        .filter(d => d.turnover > 0)
        .sort((a, b) => b.turnover - a.turnover);
    },
    enabled: chartView === 'margin' && hasEodData,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch balance comparison by department from eod_ledger_snapshots
  const { data: balanceComparison } = useQuery({
    queryKey: ['accounting-balance-comparison', selectedDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('eod_ledger_snapshots')
        .select('department, opening_balance, closing_balance')
        .eq('eod_date', selectedDateStr);
      
      if (error) throw error;
      
      // Group by department and calculate margin loans (negative balances)
      const deptMap = new Map<string, {
        department: string;
        beginning_loan: number;
        ending_loan: number;
        loan_change: number;
        change_percent: number;
        client_count: number;
      }>();
      
      (data || []).forEach(row => {
        const dept = row.department || 'Unknown';
        // Margin loan = absolute value of negative balance
        const openingLoan = Number(row.opening_balance) < 0 ? Math.abs(Number(row.opening_balance)) : 0;
        const closingLoan = Number(row.closing_balance) < 0 ? Math.abs(Number(row.closing_balance)) : 0;
        const isMarginClient = openingLoan > 0 || closingLoan > 0;
        
        const existing = deptMap.get(dept);
        
        if (existing) {
          existing.beginning_loan += openingLoan;
          existing.ending_loan += closingLoan;
          existing.client_count += isMarginClient ? 1 : 0;
        } else {
          deptMap.set(dept, {
            department: dept,
            beginning_loan: openingLoan,
            ending_loan: closingLoan,
            loan_change: 0,
            change_percent: 0,
            client_count: isMarginClient ? 1 : 0,
          });
        }
      });
      
      // Calculate change and percentage
      return Array.from(deptMap.values())
        .map(d => ({
          ...d,
          loan_change: d.ending_loan - d.beginning_loan,
          change_percent: d.beginning_loan > 0 
            ? ((d.ending_loan - d.beginning_loan) / d.beginning_loan) * 100 
            : 0,
        }))
        .filter(d => d.ending_loan > 0 || d.beginning_loan > 0)
        .sort((a, b) => b.ending_loan - a.ending_loan);
    },
    enabled: chartView === 'margin' && hasEodData,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch turnover by department from eod_ledger_snapshots - with pagination to get ALL data
  const { data: turnoverByDept } = useQuery({
    queryKey: ['accounting-turnover-by-department-full', selectedDateStr],
    queryFn: async () => {
      // Use pagination to fetch ALL rows (bypasses 1000 row limit)
      const PAGE_SIZE = 1000;
      let allData: { department: string | null; gross_buy: number | null; gross_sell: number | null; rm_name: string | null }[] = [];
      let page = 0;
      let hasMore = true;
      
      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        const { data, error } = await supabase
          .from('eod_ledger_snapshots')
          .select('department, gross_buy, gross_sell, rm_name')
          .eq('eod_date', selectedDateStr)
          .range(from, to);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          allData = [...allData, ...data];
        }
        
        hasMore = data?.length === PAGE_SIZE;
        page++;
      }
      
      // First pass: aggregate turnover by RM within each department
      const rmByDept = new Map<string, Map<string, number>>();
      
      allData.forEach(row => {
        const dept = row.department || 'Unknown';
        const rmName = row.rm_name || '';
        const turnover = (Number(row.gross_buy) || 0) + (Number(row.gross_sell) || 0);
        
        if (!rmByDept.has(dept)) {
          rmByDept.set(dept, new Map());
        }
        const deptRms = rmByDept.get(dept)!;
        deptRms.set(rmName, (deptRms.get(rmName) || 0) + turnover);
      });
      
      // Find top RM for each department
      const topRmByDept = new Map<string, { name: string; turnover: number }>();
      rmByDept.forEach((rms, dept) => {
        let topRm = { name: '', turnover: 0 };
        rms.forEach((turnover, rmName) => {
          if (rmName && turnover > topRm.turnover) {
            topRm = { name: rmName, turnover };
          }
        });
        topRmByDept.set(dept, topRm);
      });
      
      // Second pass: aggregate department totals
      const deptMap = new Map<string, { 
        department: string; 
        total_turnover: number; 
        trade_count: number;
        active_clients: number;
        top_performer: string;
        top_performer_turnover: number;
      }>();
      
      allData.forEach(row => {
        const dept = row.department || 'Unknown';
        const turnover = (Number(row.gross_buy) || 0) + (Number(row.gross_sell) || 0);
        const hasTrade = turnover > 0 ? 1 : 0;
        
        const existing = deptMap.get(dept);
        
        if (existing) {
          existing.total_turnover += turnover;
          existing.trade_count += hasTrade;
          existing.active_clients += hasTrade;
        } else {
          const topRm = topRmByDept.get(dept) || { name: '', turnover: 0 };
          deptMap.set(dept, {
            department: dept,
            total_turnover: turnover,
            trade_count: hasTrade,
            active_clients: hasTrade,
            top_performer: topRm.name,
            top_performer_turnover: topRm.turnover,
          });
        }
      });
      
      // Convert to array and sort by turnover descending - include ALL departments with any turnover
      return Array.from(deptMap.values())
        .filter(d => d.total_turnover > 0)
        .sort((a, b) => b.total_turnover - a.total_turnover);
    },
    enabled: chartView === 'commission' && hasEodData,
    staleTime: 5 * 60 * 1000,
  });

  // Process accounting data with custom fields
  const accountingData = useMemo(() => {
    if (!accountingResult) {
      console.log('[AccountingTab] No accountingResult yet');
      return [];
    }
    
    console.log('[AccountingTab] Processing', accountingResult.length, 'rows');
    
    return accountingResult.map((row: any) => {
      const processedRow: AccountingRow = {
        investor_code: row.investor_code || '',
        investor_name: row.investor_name || '',
        account_type: row.account_type || '',
        rm_name: row.rm_name || '',
        department: row.department || '',
        interest_rate: 0,
        brokerage_commission: 0,
        ledger_balance: Number(row.opening_balance) || 0,
        total_deposits: Number(row.total_deposits) || 0,
        total_withdrawals: Number(row.total_withdrawals) || 0,
        gross_buy: Number(row.gross_buy) || 0,
        gross_sell: Number(row.gross_sell) || 0,
        net_buy: Number(row.gross_buy) || 0,
        net_sell: Number(row.gross_sell) || 0,
        adjusted_ledger: 0,
        accrued_interest: 0,
        brokerage_amount: Number(row.total_commission) || 0,
        final_balance: Number(row.closing_balance) || 0,
        receivable: 0,
        payable: 0,
      };

      // Calculate custom fields
      customFields.forEach(field => {
        processedRow[field.id] = evaluateFormula(field.formula, processedRow);
      });

      return processedRow;
    });
  }, [accountingResult, customFields]);

  // Get total count
  const totalCount = accountingResult?.length || 0;

  // Summary data - use aggregate query for FULL totals (not limited to 1000 rows)
  const summary = useMemo(() => {
    // Use summaryAggregates for accurate full-day totals (cards)
    // Fall back to accountingData if aggregates not loaded yet
    return {
      totalAccounts: summaryAggregates?.totalRecords ?? accountingData.length,
      marginAccounts: 0,
      totalMarginLoan: 0,
      totalAccruedInterest: 0,
      totalReceivable: 0,
      totalPayable: 0,
      totalBuy: 0,
      totalSell: 0,
      // Use aggregate data for accurate totals (covers ALL clients, not just first 1000)
      totalTradeValue: summaryAggregates?.totalTurnover ?? accountingData.reduce((sum, row) => sum + (row.gross_buy || 0) + (row.gross_sell || 0), 0),
      totalCommission: summaryAggregates?.totalCommission ?? accountingData.reduce((sum, row) => sum + (row.brokerage_amount || 0), 0),
      clientsWithTrades: summaryAggregates?.clientsWithTrades ?? accountingData.filter(row => (row.gross_buy || 0) > 0 || (row.gross_sell || 0) > 0).length,
      uniqueDepartments: summaryAggregates?.uniqueDepartments ?? new Set(accountingData.map(row => row.department).filter(Boolean)).size,
    };
  }, [summaryAggregates, accountingData]);

  const isLoading = loadingData || loadingEodStatus;

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

  const handleExport = async () => {
    const toastId = toast.loading('Fetching all records for export...');
    
    try {
      // Fetch ALL records using pagination (bypasses 1000 row limit)
      const PAGE_SIZE = 1000;
      let allData: AccountingRow[] = [];
      let page = 0;
      let hasMore = true;
      
      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        toast.loading(`Fetching records ${from + 1} - ${to + 1}...`, { id: toastId });
        
        let query = supabase
          .from('eod_ledger_snapshots')
          .select(`
            investor_code,
            investor_name,
            account_type,
            rm_name,
            department,
            opening_balance,
            total_deposits,
            total_withdrawals,
            gross_buy,
            gross_sell,
            total_commission,
            closing_balance
          `)
          .eq('eod_date', selectedDateStr)
          .order('investor_code')
          .range(from, to);
        
        // Apply same filters as UI
        if (debouncedSearch) {
          query = query.or(`investor_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%,rm_name.ilike.%${debouncedSearch}%`);
        }
        if (accountTypeFilter && accountTypeFilter !== 'all') {
          query = query.eq('account_type', accountTypeFilter);
        }
        if (activityFilter === 'with_trades') {
          query = query.or('gross_buy.gt.0,gross_sell.gt.0');
        } else if (activityFilter === 'no_trades') {
          query = query.or('gross_buy.is.null,gross_buy.eq.0').or('gross_sell.is.null,gross_sell.eq.0');
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          // Map to AccountingRow format
          const mappedRows: AccountingRow[] = data.map((row: any) => ({
            investor_code: row.investor_code || '',
            investor_name: row.investor_name || '',
            account_type: row.account_type || '',
            rm_name: row.rm_name || '',
            department: row.department || '',
            interest_rate: 0,
            brokerage_commission: 0,
            ledger_balance: Number(row.opening_balance) || 0,
            total_deposits: Number(row.total_deposits) || 0,
            total_withdrawals: Number(row.total_withdrawals) || 0,
            net_buy: Number(row.gross_buy) || 0,
            net_sell: Number(row.gross_sell) || 0,
            adjusted_ledger: 0,
            accrued_interest: 0,
            receivable: 0,
            payable: 0,
            brokerage_amount: Number(row.total_commission) || 0,
            final_balance: Number(row.closing_balance) || 0,
            gross_buy: Number(row.gross_buy) || 0,
            gross_sell: Number(row.gross_sell) || 0,
          }));
          allData = [...allData, ...mappedRows];
        }
        
        hasMore = data?.length === PAGE_SIZE;
        page++;
      }
      
      if (allData.length === 0) {
        toast.dismiss(toastId);
        toast.error('No data to export');
        return;
      }
      
      toast.loading(`Processing ${allData.length.toLocaleString()} records...`, { id: toastId });
      
      // Apply custom field calculations
      const exportData = allData.map(row => {
        const processedRow = { ...row };
        customFields.forEach(field => {
          processedRow[field.id] = evaluateFormula(field.formula, row);
        });
        return processedRow;
      });
      
      // Get visible columns
      const exportColumns = visibleColumns;
      
      // Build headers
      const headers = exportColumns.map(col => col.label);
      const customHeaders = customFields.map(f => f.name);
      const allHeaders = [...headers, ...customHeaders];
      
      // Build CSV rows
      const csvData = exportData.map(row => {
        const rowData = exportColumns.map(col => {
          const value = row[col.id];
          if (col.id === 'investor_code' || col.id === 'investor_name' || 
              col.id === 'account_type' || col.id === 'rm_name' || 
              col.id === 'department') {
            const strVal = String(value || '');
            return strVal.includes(',') || strVal.includes('"') 
              ? `"${strVal.replace(/"/g, '""')}"` 
              : strVal;
          }
          if (typeof value === 'number') {
            return value.toFixed(2);
          }
          return value || '';
        });
        
        const customData = customFields.map(f => {
          const val = row[f.id];
          return typeof val === 'number' ? val.toFixed(2) : (val || 0);
        });
        
        return [...rowData, ...customData];
      });
      
      // Generate CSV
      const csv = [allHeaders.join(','), ...csvData.map(row => row.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounting_${selectedDateStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.dismiss(toastId);
      toast.success(`Exported ${allData.length.toLocaleString()} records`);
    } catch (err) {
      console.error('Export error:', err);
      toast.dismiss(toastId);
      toast.error('Failed to export data');
    }
  };

  const toggleColumnVisibility = (columnId: string) => {
    setColumns(cols => cols.map(c => 
      c.id === columnId ? { ...c, visible: !c.visible } : c
    ));
  };

  const moveColumn = (columnId: string, direction: 'up' | 'down') => {
    setColumns(cols => {
      const index = cols.findIndex(c => c.id === columnId);
      if (index === -1) return cols;
      if (direction === 'up' && index === 0) return cols;
      if (direction === 'down' && index === cols.length - 1) return cols;
      
      const newCols = [...cols];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newCols[index], newCols[swapIndex]] = [newCols[swapIndex], newCols[index]];
      return newCols;
    });
  };

  const visibleColumns = columns.filter(c => c.visible);

  // Sort handler
  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  };

  // Drag and drop handlers for column reordering
  const handleDragStart = (columnId: string) => {
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;

    setColumns(cols => {
      const draggedIndex = cols.findIndex(c => c.id === draggedColumn);
      const targetIndex = cols.findIndex(c => c.id === targetColumnId);
      if (draggedIndex === -1 || targetIndex === -1) return cols;

      const newCols = [...cols];
      const [removed] = newCols.splice(draggedIndex, 1);
      newCols.splice(targetIndex, 0, removed);
      return newCols;
    });
    setDraggedColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
  };

  // Client-side sorting for all columns
  const sortedData = useMemo(() => {
    return [...accountingData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      // Handle string columns (investor_code, investor_name, account_type)
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      
      // Handle numeric columns (including final_balance / Closing Balance)
      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });
  }, [accountingData, sortColumn, sortDirection]);

  const getCellValue = (row: AccountingRow, columnId: string) => {
    const value = row[columnId];
    if (columnId === 'investor_code' || columnId === 'investor_name' || columnId === 'account_type') {
      return value;
    }
    if (typeof value === 'number') {
      if (columnId === 'interest_rate' || columnId === 'brokerage_commission') {
        return value.toFixed(4);
      }
      return value > 0 || value < 0 ? formatCurrency(value) : '-';
    }
    return value || '-';
  };

  const getCellClassName = (row: AccountingRow, column: ColumnConfig) => {
    const value = row[column.id];
    const baseClass = column.align === 'right' ? 'text-right' : '';
    
    if (column.id === 'investor_code') return `${baseClass} font-mono`;
    if (column.id === 'investor_name') return `${baseClass} truncate max-w-[200px]`;
    if (column.id === 'ledger_balance' && typeof value === 'number' && value < 0) return `${baseClass} text-red-400`;
    if (column.id === 'adjusted_ledger' && typeof value === 'number' && value < 0) return `${baseClass} font-medium text-red-400`;
    if (column.id === 'adjusted_ledger') return `${baseClass} font-medium`;
    if (column.id === 'net_sell' && typeof value === 'number') {
      if (value > 0) return `${baseClass} text-green-400`;
      if (value < 0) return `${baseClass} text-red-400`;
    }
    if (column.colorClass && typeof value === 'number' && value !== 0) return `${baseClass} ${column.colorClass}`;
    
    return baseClass;
  };

  return (
    <div className="space-y-4 lg:space-y-6 w-full overflow-x-hidden">
      {/* No EOD Data Alert */}
      {!hasEodData && !loadingEodStatus && (
        <Alert className="mb-4 border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span>
              No EOD data for <strong>{format(selectedDate, "PPP")}</strong>. Run EOD processing first.
            </span>
            <Button variant="outline" size="sm" asChild className="shrink-0 border-amber-500/50 text-amber-400 hover:bg-amber-500/20">
              <a href="/eod">
                <LinkIcon className="h-4 w-4 mr-2" />
                Go to EOD Page
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Error Display */}
      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{(queryError as Error)?.message || 'Failed to load accounting data'}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Unmatched Investors Warning */}
      <UnmatchedDataWarning selectedDate={selectedDate} />

      {/* Summary Cards - Sticky */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-3 lg:pb-4 -mx-4 px-4 pt-2">
        {/* Department Charts - Clickable Toggle */}
        <Card className="mt-4 glass-card">
          <CardContent className="p-4">
            {/* Chart View Tabs */}
            <div className="flex gap-1 mb-4 p-1 bg-muted/30 rounded-lg w-fit">
              <button
                onClick={() => setChartView('margin')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  chartView === 'margin' 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Margin Loan
              </button>
              <button
                onClick={() => setChartView('commission')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  chartView === 'commission' 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Commission
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
              {/* Margin Loan View */}
              {chartView === 'margin' && (
                <div className="w-full space-y-6">
                  {/* Date Indicator */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5 border border-border/50 w-fit">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span className="font-medium">EOD Date:</span>
                    <span className="text-foreground">{format(selectedDate, 'MMM dd, yyyy')}</span>
                  </div>

                  {/* KPI Metrics Row */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Beginning Loan Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-500/20 via-slate-500/10 to-transparent border border-slate-500/30 p-4 group hover:border-slate-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-slate-500/20">
                            <Wallet className="h-4 w-4 text-slate-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30">
                            OPENING
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Beginning Loan</p>
                        <p className="text-2xl font-bold text-slate-300">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { beginning_loan: number }) => sum + Number(d.beginning_loan), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400/80">
                          <span>{balanceComparison?.length || 0} departments</span>
                        </div>
                      </div>
                    </div>

                    {/* Ending Loan Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-rose-500/20 via-rose-500/10 to-transparent border border-rose-500/30 p-4 group hover:border-rose-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-rose-500/20">
                            <TrendingUp className="h-4 w-4 text-rose-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            CLOSING
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Ending Loan</p>
                        <p className="text-2xl font-bold text-rose-400">
                          {formatCurrency(balanceComparison?.reduce((sum: number, d: { ending_loan: number }) => sum + Number(d.ending_loan), 0) || 0)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-rose-400/80">
                          <span>Current outstanding</span>
                        </div>
                      </div>
                    </div>

                    {/* Loan Change Card */}
                    {(() => {
                      const totalChange = balanceComparison?.reduce((sum: number, d: { loan_change: number }) => sum + Number(d.loan_change), 0) || 0;
                      const isPositiveChange = totalChange <= 0; // Decrease in loan is positive
                      return (
                        <div className={cn(
                          "relative overflow-hidden rounded-xl p-4 group transition-all duration-300",
                          isPositiveChange 
                            ? "bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent border border-emerald-500/30 hover:border-emerald-500/50"
                            : "bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent border border-red-500/30 hover:border-red-500/50"
                        )}>
                          <div className={cn(
                            "absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl transform translate-x-8 -translate-y-8",
                            isPositiveChange ? "bg-emerald-500/10" : "bg-red-500/10"
                          )} />
                          <div className="relative">
                            <div className="flex items-center justify-between mb-2">
                              <div className={cn(
                                "p-2 rounded-lg",
                                isPositiveChange ? "bg-emerald-500/20" : "bg-red-500/20"
                              )}>
                                {isPositiveChange ? (
                                  <TrendingDown className="h-4 w-4 text-emerald-400" />
                                ) : (
                                  <TrendingUp className="h-4 w-4 text-red-400" />
                                )}
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                                isPositiveChange 
                                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                  : "bg-red-500/20 text-red-400 border-red-500/30"
                              )}>
                                CHANGE
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">Loan Change</p>
                            <p className={cn(
                              "text-2xl font-bold",
                              isPositiveChange ? "text-emerald-400" : "text-red-400"
                            )}>
                              {isPositiveChange ? '-' : '+'}{formatCurrency(Math.abs(totalChange))}
                            </p>
                            <div className={cn(
                              "mt-2 flex items-center gap-1 text-xs",
                              isPositiveChange ? "text-emerald-400/80" : "text-red-400/80"
                            )}>
                              <span>{isPositiveChange ? 'Loan decreased' : 'Loan increased'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Client Count Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/20 via-violet-500/10 to-transparent border border-violet-500/30 p-4 group hover:border-violet-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-violet-500/20">
                            <Users className="h-4 w-4 text-violet-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                            CLIENTS
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Clients</p>
                        <p className="text-2xl font-bold text-violet-400">
                          {(balanceComparison?.reduce((sum: number, d: { client_count: number }) => sum + Number(d.client_count || 0), 0) || 0).toLocaleString()}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-violet-400/80">
                          <span>Active margin accounts</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Charts and Table Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Enhanced Pie Chart */}
                    <div className="lg:col-span-1 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Distribution</h4>
                        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
                          By Department
                        </span>
                      </div>
                      <div className="h-56 w-full">
                        {balanceComparison && balanceComparison.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <defs>
                                <linearGradient id="loanGrad1" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(350, 89%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(350, 89%, 45%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad2" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(217, 91%, 60%)" />
                                  <stop offset="100%" stopColor="hsl(217, 91%, 45%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad3" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(43, 96%, 56%)" />
                                  <stop offset="100%" stopColor="hsl(43, 96%, 40%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad4" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(280, 87%, 65%)" />
                                  <stop offset="100%" stopColor="hsl(280, 87%, 50%)" />
                                </linearGradient>
                                <linearGradient id="loanGrad5" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor="hsl(160, 84%, 39%)" />
                                  <stop offset="100%" stopColor="hsl(160, 84%, 29%)" />
                                </linearGradient>
                              </defs>
                              <Pie
                                data={balanceComparison.map((dept: { department: string; ending_loan: number }, index: number) => ({
                                  name: dept.department || 'Unknown',
                                  value: Number(dept.ending_loan),
                                }))}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={85}
                                paddingAngle={3}
                                dataKey="value"
                                stroke="none"
                              >
                                {balanceComparison.map((_: any, index: number) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={`url(#loanGrad${(index % 5) + 1})`}
                                    className="drop-shadow-lg"
                                  />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value: number) => formatCurrency(value)}
                                contentStyle={{ 
                                  backgroundColor: 'hsl(var(--popover))', 
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '12px',
                                  fontSize: '12px',
                                  boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                            No margin loan data available
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Department Breakdown Table - Enhanced */}
                    <div className="lg:col-span-2 p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold">Department Breakdown</h4>
                        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
                          {balanceComparison?.length || 0} Departments
                        </span>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {balanceComparison && balanceComparison.length > 0 ? (
                          <div className="space-y-2">
                            {balanceComparison
                              .sort((a: { ending_loan: number }, b: { ending_loan: number }) => Number(b.ending_loan) - Number(a.ending_loan))
                              .map((dept: { department: string; beginning_loan: number; ending_loan: number; loan_change: number; change_percent: number; client_count: number }, index: number) => {
                                const maxLoan = Math.max(...balanceComparison.map((d: { ending_loan: number }) => Number(d.ending_loan)));
                                const barWidth = maxLoan > 0 ? (Number(dept.ending_loan) / maxLoan) * 100 : 0;
                                const isDecrease = Number(dept.loan_change) <= 0;
                                
                                return (
                                  <div 
                                    key={index}
                                    className={cn(
                                      "relative p-3 rounded-lg border transition-all duration-200 hover:border-border group",
                                      index % 2 === 0 ? "bg-muted/20" : "bg-transparent",
                                      "border-border/30"
                                    )}
                                  >
                                    {/* Background bar showing distribution */}
                                    <div 
                                      className="absolute left-0 top-0 h-full rounded-lg bg-gradient-to-r from-rose-500/10 to-transparent transition-all duration-500"
                                      style={{ width: `${barWidth}%` }}
                                    />
                                    
                                    <div className="relative flex items-center gap-3">
                                      {/* Rank Badge */}
                                      <div className={cn(
                                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                                        index === 0 ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30" :
                                        index === 1 ? "bg-slate-400/20 text-slate-400 ring-1 ring-slate-400/30" :
                                        index === 2 ? "bg-orange-600/20 text-orange-400 ring-1 ring-orange-600/30" :
                                        "bg-muted/50 text-muted-foreground"
                                      )}>
                                        {index + 1}
                                      </div>

                                      {/* Department Info */}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{dept.department || 'Unknown'}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                          {dept.client_count || 0} clients
                                        </p>
                                      </div>

                                      {/* Loan Values */}
                                      <div className="flex items-center gap-4 text-right">
                                        <div className="hidden sm:block">
                                          <p className="text-[10px] text-muted-foreground">Beginning</p>
                                          <p className="text-xs font-medium text-slate-400">
                                            {formatCurrency(Number(dept.beginning_loan))}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] text-muted-foreground">Ending</p>
                                          <p className="text-sm font-bold text-rose-400">
                                            {formatCurrency(Number(dept.ending_loan))}
                                          </p>
                                        </div>
                                        <div className={cn(
                                          "flex flex-col items-end px-2 py-1 rounded-lg",
                                          isDecrease ? "bg-emerald-500/10" : "bg-red-500/10"
                                        )}>
                                          <div className={cn(
                                            "flex items-center gap-1 text-xs font-semibold",
                                            isDecrease ? "text-emerald-400" : "text-red-400"
                                          )}>
                                            {isDecrease ? (
                                              <ArrowDownToLine className="h-3 w-3" />
                                            ) : (
                                              <ArrowUpFromLine className="h-3 w-3" />
                                            )}
                                            {formatCurrency(Math.abs(Number(dept.loan_change)))}
                                          </div>
                                          <p className={cn(
                                            "text-[10px]",
                                            isDecrease ? "text-emerald-400/70" : "text-red-400/70"
                                          )}>
                                            {Number(dept.change_percent).toFixed(1)}%
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                            No margin loan data available for this period
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Commission View - Premium Design */}
              {chartView === 'commission' && (
                <div className="w-full space-y-6">
                  {/* KPI Metrics Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Total Commission Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent border border-emerald-500/30 p-4 group hover:border-emerald-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-emerald-500/20">
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            REVENUE
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Commission</p>
                        <p className="text-2xl font-bold text-emerald-400">
                          {formatCurrency(summary.totalCommission)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400/80">
                          <span className="inline-flex items-center gap-0.5">
                            <DollarSign className="h-3 w-3" />
                            {summary.uniqueDepartments} departments
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Total Turnover Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent border border-blue-500/30 p-4 group hover:border-blue-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-blue-500/20">
                            <ArrowDownRight className="h-4 w-4 text-blue-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            VOLUME
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Total Turnover</p>
                        <p className="text-2xl font-bold text-blue-400">
                          {formatCurrency(summary.totalTradeValue)}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-blue-400/80">
                          <span>Across all departments</span>
                        </div>
                      </div>
                    </div>

                    {/* Clients with Trades Card */}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-transparent border border-amber-500/30 p-4 group hover:border-amber-500/50 transition-all duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-8" />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 rounded-lg bg-amber-500/20">
                            <Users className="h-4 w-4 text-amber-400" />
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            ACTIVITY
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">Clients with Trades</p>
                        <p className="text-2xl font-bold text-amber-400">
                          {summary.clientsWithTrades.toLocaleString()}
                        </p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-amber-400/80">
                          <span>Active trading accounts</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Department Turnover Grid */}
                  <DepartmentTurnoverGrid 
                    data={turnoverByDept || []} 
                    totalTurnover={summary.totalTradeValue}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <div className="space-y-3 lg:space-y-4">
        {/* Search Bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code, name, or RM..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10 bg-muted/30 border-border/50"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {debouncedSearch && (
            <span className="absolute -bottom-5 left-0 text-xs text-muted-foreground">
              {totalCount} result{Number(totalCount) !== 1 ? 's' : ''} found
            </span>
          )}
        </div>

        {/* Actions Row - Filters and Date */}
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">
          {/* Account Type Filter */}
          <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
            <SelectTrigger className="w-[130px] h-9 bg-muted/30 border-border/50">
              <SelectValue placeholder="Account Type" />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-50">
              <SelectItem value="all">All Accounts</SelectItem>
              <SelectItem value="Cash">Cash</SelectItem>
              <SelectItem value="Margin">Margin</SelectItem>
            </SelectContent>
          </Select>

          {/* Activity Filter */}
          <Select value={activityFilter} onValueChange={setActivityFilter}>
            <SelectTrigger className="w-[140px] h-9 bg-muted/30 border-border/50">
              <SelectValue placeholder="Activity" />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-50">
              <SelectItem value="all">All Clients</SelectItem>
              <SelectItem value="with_trades">With Trades</SelectItem>
              <SelectItem value="no_trades">No Trades</SelectItem>
            </SelectContent>
          </Select>

          {/* Single EOD Date Selection */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 rounded-lg border border-border/50">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">EOD Date:</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-3 font-medium">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, 'dd MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-background border">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(normalizeToLocalDate(date))}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* EOD Status Indicator */}
          {hasEodData && eodStatus && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 px-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{eodStatus.clients_captured?.toLocaleString()} clients captured</span>
            </div>
          )}

          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto flex-wrap">
            <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-xs lg:text-sm">
                  <Settings className="h-4 w-4 mr-1 lg:mr-2" />
                  <span className="hidden sm:inline">Custom </span>Fields
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Manage Custom Fields</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Add formula-based fields that appear as extra columns in the table.
                  </DialogDescription>
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
                        placeholder="e.g., max(0, net_sell)"
                        value={newFieldFormula}
                        onChange={(e) => setNewFieldFormula(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Fields: ledger, deposits, withdrawals, net_sell, adjusted_ledger, accrued_interest, interest_rate, receivable, payable, gross_buy, gross_sell, brokerage_amount
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Functions: ABS(), MAX(a, b), MIN(a, b)
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

            {/* Column Settings Dialog */}
            <Dialog open={isColumnDialogOpen} onOpenChange={setIsColumnDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none text-xs lg:text-sm">
                  <Eye className="h-4 w-4 mr-1 lg:mr-2" />
                  Columns
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Configure Columns</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Toggle visibility and reorder columns. Closing Balance is at the end.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {columns.map((column, index) => (
                    <div key={column.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={column.visible}
                          onCheckedChange={() => toggleColumnVisibility(column.id)}
                        />
                        <span className={cn("text-sm", !column.visible && "text-muted-foreground")}>
                          {column.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveColumn(column.id, 'up')}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveColumn(column.id, 'down')}
                          disabled={index === columns.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pt-4 border-t">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => {
                      setColumns(DEFAULT_COLUMNS);
                      localStorage.removeItem(COLUMNS_STORAGE_KEY);
                      toast.success('Columns reset to defaults');
                    }}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleExport} className="flex-1 sm:flex-none text-xs lg:text-sm">
                <Download className="h-4 w-4 mr-1 lg:mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Debug Info */}
      <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-2 items-center">
        <span>Fetched: <strong>{accountingResult?.length ?? 0}</strong> rows</span>
        <span>|</span>
        <span>EOD Date: {format(selectedDate, 'MMM dd, yyyy')}</span>
        <span>|</span>
        <span>Visible columns: <strong>{visibleColumns.length}</strong></span>
        {visibleColumns.length === 0 && (
          <Button 
            variant="outline" 
            size="sm" 
            className="h-6 text-xs ml-2"
            onClick={() => {
              setColumns(DEFAULT_COLUMNS);
              localStorage.removeItem(COLUMNS_STORAGE_KEY);
              toast.success('Columns reset to defaults');
            }}
          >
            Reset Columns
          </Button>
        )}
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
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !hasEodData ? (
            <div className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No EOD Data Available</h3>
              <p className="text-muted-foreground mb-4">
                EOD processing has not been run for {format(selectedDate, "PPP")}.
              </p>
              <Button asChild>
                <a href="/eod">
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Go to EOD Page
                </a>
              </Button>
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {visibleColumns.map(column => (
                        <TableHead 
                          key={column.id} 
                          className={cn(
                            "min-w-[100px] cursor-pointer select-none transition-colors hover:bg-muted/80",
                            column.align === 'right' && "text-right",
                            column.colorClass,
                            draggedColumn === column.id && "opacity-50 bg-primary/20"
                          )}
                          draggable
                          onDragStart={() => handleDragStart(column.id)}
                          onDragOver={(e) => handleDragOver(e, column.id)}
                          onDrop={(e) => handleDrop(e, column.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => handleSort(column.id)}
                        >
                          <div className={cn(
                            "flex items-center gap-1",
                            column.align === 'right' && "justify-end"
                          )}>
                            <GripVertical className="h-3 w-3 text-muted-foreground/50 cursor-grab" />
                            <span>{column.label}</span>
                            {sortColumn === column.id ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-primary" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-primary" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />
                            )}
                          </div>
                        </TableHead>
                      ))}
                      {customFields.map(field => (
                        <TableHead 
                          key={field.id} 
                          className="text-right min-w-[100px] text-primary cursor-pointer hover:bg-muted/80"
                          onClick={() => handleSort(field.id)}
                        >
                          <div className="flex items-center gap-1 justify-end">
                            <span>{field.name}</span>
                            {sortColumn === field.id ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp className="h-3 w-3 text-primary" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-primary" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />
                            )}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="w-[40px] min-w-[40px]">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0 hover:bg-primary/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsFieldDialogOpen(true);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={visibleColumns.length + customFields.length + 1} className="text-center py-8 text-muted-foreground">
                          No accounting data found for the selected criteria
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedData.map((row, index) => (
                        <TableRow 
                          key={`${row.investor_code}-${index}`}
                          className="hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setSelectedInvestor(row)}
                        >
                          {visibleColumns.map(column => (
                            <TableCell 
                              key={column.id}
                              className={getCellClassName(row, column)}
                            >
                              {column.id === 'gross_buy' ? (
                                <button
                                  className="text-red-400 hover:underline hover:text-red-300 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTradeInvestor(row);
                                    setSelectedTradeType('BUY');
                                    setTradeDetailsOpen(true);
                                  }}
                                >
                                  {getCellValue(row, column.id)}
                                </button>
                              ) : column.id === 'gross_sell' ? (
                                <button
                                  className="text-green-400 hover:underline hover:text-green-300 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTradeInvestor(row);
                                    setSelectedTradeType('SELL');
                                    setTradeDetailsOpen(true);
                                  }}
                                >
                                  {getCellValue(row, column.id)}
                                </button>
                              ) : (
                                getCellValue(row, column.id)
                              )}
                            </TableCell>
                          ))}
                          {customFields.map(field => (
                            <TableCell key={field.id} className="text-right text-primary">
                              {typeof row[field.id] === 'number' 
                                ? formatCurrency(row[field.id] as number)
                                : row[field.id]}
                            </TableCell>
                          ))}
                          <TableCell className="w-[40px]" />
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation Dialog */}
      {selectedInvestor && (
        <AccountingReconciliationDialog
          investor={selectedInvestor}
          onClose={() => setSelectedInvestor(null)}
          fromDate={selectedDate}
          toDate={selectedDate}
        />
      )}

      {/* Trade Details Dialog */}
      {selectedTradeInvestor && (
        <TradeDetailsDialog
          open={tradeDetailsOpen}
          onOpenChange={setTradeDetailsOpen}
          investorCode={selectedTradeInvestor.investor_code}
          investorName={selectedTradeInvestor.investor_name}
          tradeType={selectedTradeType}
          fromDate={selectedDate}
          toDate={selectedDate}
        />
      )}
    </div>
  );
};

export default AccountingTab;
