import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  TrendingUp, 
  Wallet, 
  Percent, 
  AlertTriangle,
  Users,
  DollarSign,
  Activity,
  Clock
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

// Health distribution colors
const COLORS = {
  safe: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444"
};

interface MarginEquitySnapshot {
  investor_code: string;
  eod_date: string;
  rm_name: string | null;
  department_name: string | null;
  ledger_closing_balance: number;
  marginable_after_haircut: number;
  non_marginable_holdings: number;
  total_portfolio_value: number;
  previous_day_balance: number;
  margin_interest_rate: number;
  accrued_interest: number;
  equity: number;
}

export function DashboardTab() {
  // Fetch margin equity snapshots from the view - get latest date only
  const { data: equitySnapshots, isLoading: loadingSnapshots } = useQuery({
    queryKey: ['margin-equity-snapshots'],
    queryFn: async () => {
      // First get the latest EOD date
      const { data: latestDateData, error: dateError } = await supabase
        .from('eod_ledger_snapshots')
        .select('eod_date')
        .order('eod_date', { ascending: false })
        .limit(1);
      
      if (dateError) throw dateError;
      if (!latestDateData || latestDateData.length === 0) return [];
      
      const latestDate = latestDateData[0].eod_date;
      
      // Query the view for the latest date only (using any to bypass type checking for view)
      const { data, error } = await (supabase as any)
        .from('margin_equity_snapshots')
        .select('*')
        .eq('eod_date', latestDate);
      
      if (error) throw error;
      return (data as MarginEquitySnapshot[]) || [];
    }
  });

  // Fetch margin accounts summary
  const { data: accountsSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['margin-accounts-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('margin_accounts')
        .select('*');
      
      if (error) throw error;
      
      // Calculate summary metrics
      const totalExposure = data?.reduce((sum, acc) => sum + (acc.current_exposure || 0), 0) || 0;
      const totalLimit = data?.reduce((sum, acc) => sum + (acc.approved_limit || 0), 0) || 0;
      const avgUtilization = data?.length 
        ? data.reduce((sum, acc) => sum + (acc.margin_utilization || 0), 0) / data.length 
        : 0;
      
      return {
        totalAccounts: data?.length || 0,
        totalExposure,
        totalLimit,
        avgUtilization,
        activeAccounts: data?.filter(a => a.status === 'active').length || 0
      };
    }
  });

  // Fetch margin calls count
  const { data: marginCallsCount, isLoading: loadingCalls } = useQuery({
    queryKey: ['margin-calls-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('margin_calls')
        .select('*', { count: 'exact', head: true })
        .in('status', ['issued', 'acknowledged']);
      
      if (error) throw error;
      return count || 0;
    }
  });

  // Calculate metrics from equity snapshots
  const snapshotMetrics = (() => {
    if (!equitySnapshots || equitySnapshots.length === 0) {
      return {
        totalEquity: 0,
        totalPortfolioValue: 0,
        totalMarginOutstanding: 0,
        totalAccruedInterest: 0,
        highRiskCount: 0,
        warningCount: 0,
        safeCount: 0,
        topClients: [],
        avgMarginRatio: 0,
        availableCapacity: 0,
        overallUtilization: 0,
      };
    }

    // Get unique latest records per investor
    const latestDate = equitySnapshots[0]?.eod_date;
    const latestSnapshots = equitySnapshots.filter(s => s.eod_date === latestDate);
    
    // Calculate margin ratio for each client
    // Margin Ratio = Equity / Negative Ledger Balance (exposure)
    const clientsWithRatio = latestSnapshots.map(s => {
      const exposure = Math.abs(Math.min(s.ledger_closing_balance, 0));
      const marginRatio = exposure > 0 ? (s.equity / exposure) * 100 : 999;
      return {
        ...s,
        exposure,
        marginRatio
      };
    }).filter(c => c.exposure > 0); // Only margin clients (negative balance)

    // Health distribution
    const safeCount = clientsWithRatio.filter(c => c.marginRatio >= 130).length;
    const warningCount = clientsWithRatio.filter(c => c.marginRatio >= 110 && c.marginRatio < 130).length;
    const highRiskCount = clientsWithRatio.filter(c => c.marginRatio < 110).length;

    // Total portfolio value from view
    const totalPortfolioValue = latestSnapshots.reduce(
      (sum, s) => sum + (s.total_portfolio_value || 0), 0
    );

    // Total margin outstanding (sum of negative balances)
    const totalMarginOutstanding = latestSnapshots.reduce(
      (sum, s) => sum + Math.abs(Math.min(s.ledger_closing_balance, 0)), 0
    );

    // Total equity
    const totalEquity = latestSnapshots.reduce((sum, s) => sum + s.equity, 0);

    // Total accrued interest
    const totalAccruedInterest = latestSnapshots.reduce((sum, s) => sum + s.accrued_interest, 0);

    // Average Margin Ratio = (Total Margin Outstanding / Total Portfolio Value) * 100
    const avgMarginRatio = totalPortfolioValue > 0
      ? (totalMarginOutstanding / totalPortfolioValue) * 100
      : 0;

    // Top 10 clients by exposure
    const topClients = [...clientsWithRatio]
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 10);

    // Available Capacity = Total Portfolio Value - Total Margin Outstanding
    const availableCapacity = Math.max(0, totalPortfolioValue - totalMarginOutstanding);

    // Overall Utilization = (Total Margin Outstanding / Total Portfolio Value) * 100
    const overallUtilization = totalPortfolioValue > 0
      ? (totalMarginOutstanding / totalPortfolioValue) * 100
      : 0;

    return {
      totalEquity,
      totalPortfolioValue,
      totalMarginOutstanding,
      totalAccruedInterest,
      highRiskCount,
      warningCount,
      safeCount,
      topClients,
      avgMarginRatio,
      availableCapacity,
      overallUtilization,
    };
  })();

  // Build health distribution data for pie chart
  const healthData = [
    { name: "Safe (>130%)", value: snapshotMetrics.safeCount, color: COLORS.safe },
    { name: "Warning (110-130%)", value: snapshotMetrics.warningCount, color: COLORS.warning },
    { name: "Critical (<110%)", value: snapshotMetrics.highRiskCount, color: COLORS.critical }
  ].filter(d => d.value > 0);

  const formatCurrency = (value: number) => {
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getMarginRatioBadge = (ratio: number) => {
    if (ratio >= 130) return <Badge className="bg-green-500/20 text-green-400">Safe</Badge>;
    if (ratio >= 110) return <Badge className="bg-yellow-500/20 text-yellow-400">Warning</Badge>;
    return <Badge className="bg-red-500/20 text-red-400">Critical</Badge>;
  };

  const isLoading = loadingSummary || loadingCalls || loadingSnapshots;

  return (
    <div className="space-y-6">
      {/* Top KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Margin Outstanding
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(snapshotMetrics.totalMarginOutstanding)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across all margin accounts
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Portfolio Value
            </CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(snapshotMetrics.totalPortfolioValue)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Total collateral value
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overall Utilization
            </CardTitle>
            <Percent className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {snapshotMetrics.overallUtilization.toFixed(1)}%
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Average margin utilization
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Clients in Margin Call
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-foreground">{marginCallsCount}</span>
                {(marginCallsCount ?? 0) > 0 && (
                  <Badge variant="destructive" className="animate-pulse">
                    Action Required
                  </Badge>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Active margin calls
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Second KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              High-Risk Clients
            </CardTitle>
            <Users className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-foreground">{snapshotMetrics.highRiskCount}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Below 110% margin ratio
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Available Capacity
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(snapshotMetrics.availableCapacity)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Unused margin capacity
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Average Margin Ratio
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {snapshotMetrics.avgMarginRatio.toFixed(0)}%
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across all accounts
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Interest Accrued
            </CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(snapshotMetrics.totalAccruedInterest)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              From latest snapshot
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Margin Health Distribution */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Margin Health Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Skeleton className="h-48 w-48 rounded-full" />
                </div>
              ) : healthData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={healthData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {healthData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        borderColor: 'hsl(var(--border))',
                        color: 'hsl(var(--foreground))'
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No margin account data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top 10 Clients by Exposure */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Top 10 Clients by Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : snapshotMetrics.topClients.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>RM</TableHead>
                      <TableHead className="text-right">Exposure</TableHead>
                      <TableHead className="text-right">Ratio</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshotMetrics.topClients.map((client) => (
                      <TableRow key={client.investor_code}>
                        <TableCell className="font-mono text-sm">{client.investor_code}</TableCell>
                        <TableCell className="text-sm">{client.rm_name || '-'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(client.exposure)}</TableCell>
                        <TableCell className="text-right">{client.marginRatio.toFixed(0)}%</TableCell>
                        <TableCell>{getMarginRatioBadge(client.marginRatio)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No margin exposure data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
