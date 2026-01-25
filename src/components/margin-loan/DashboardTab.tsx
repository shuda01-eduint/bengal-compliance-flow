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
import { useMemo } from "react";

// Health distribution colors
const COLORS = {
  safe: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444"
};

interface DashboardSummary {
  eod_date: string | null;
  total_margin_outstanding: number;
  total_portfolio_value: number;
  total_equity: number;
  total_accrued_interest: number;
  high_risk_count: number;
  warning_count: number;
  safe_count: number;
  total_margin_clients: number;
}

interface TopClient {
  investor_code: string;
  rm_name: string | null;
  department_name: string | null;
  exposure: number;
  margin_ratio: number;
  equity: number;
  portfolio_value: number;
}

const defaultSummary: DashboardSummary = {
  eod_date: null,
  total_margin_outstanding: 0,
  total_portfolio_value: 0,
  total_equity: 0,
  total_accrued_interest: 0,
  high_risk_count: 0,
  warning_count: 0,
  safe_count: 0,
  total_margin_clients: 0
};

export function DashboardTab() {
  // Fetch dashboard summary via RPC (server-side aggregation)
  const { data: dashboardSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['margin-dashboard-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_dashboard_summary' as any);
      if (error) throw error;
      return (data as DashboardSummary) || defaultSummary;
    }
  });

  // Fetch top clients via RPC
  const { data: topClients, isLoading: loadingClients } = useQuery({
    queryKey: ['margin-top-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_top_margin_clients' as any, { p_limit: 10 });
      if (error) throw error;
      return (data as TopClient[]) || [];
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

  // Calculate derived metrics from summary
  const metrics = useMemo(() => {
    const summary = dashboardSummary || defaultSummary;
    const { total_margin_outstanding, total_portfolio_value } = summary;
    
    // Average Margin Ratio = (Total Margin Outstanding / Total Portfolio Value) * 100
    const avgMarginRatio = total_portfolio_value > 0
      ? (total_margin_outstanding / total_portfolio_value) * 100
      : 0;
    
    // Overall Utilization = (Total Margin Outstanding / Total Portfolio Value) * 100
    const overallUtilization = total_portfolio_value > 0
      ? (total_margin_outstanding / total_portfolio_value) * 100
      : 0;
    
    // Available Capacity = Total Portfolio Value - Total Margin Outstanding
    const availableCapacity = Math.max(0, total_portfolio_value - total_margin_outstanding);
    
    return {
      ...summary,
      avgMarginRatio,
      overallUtilization,
      availableCapacity
    };
  }, [dashboardSummary]);

  // Build health distribution data for pie chart
  const healthData = useMemo(() => {
    return [
      { name: "Safe (>130%)", value: metrics.safe_count, color: COLORS.safe },
      { name: "Warning (110-130%)", value: metrics.warning_count, color: COLORS.warning },
      { name: "Critical (<110%)", value: metrics.high_risk_count, color: COLORS.critical }
    ].filter(d => d.value > 0);
  }, [metrics]);

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

  const isLoading = loadingSummary || loadingCalls || loadingClients;

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
                {formatCurrency(metrics.total_margin_outstanding)}
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
                {formatCurrency(metrics.total_portfolio_value)}
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
                {metrics.overallUtilization.toFixed(1)}%
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
              <div className="text-2xl font-bold text-foreground">{metrics.high_risk_count}</div>
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
                {formatCurrency(metrics.availableCapacity)}
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
                {metrics.avgMarginRatio.toFixed(1)}%
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
                {formatCurrency(metrics.total_accrued_interest)}
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
              ) : topClients && topClients.length > 0 ? (
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
                    {topClients.map((client) => (
                      <TableRow key={client.investor_code}>
                        <TableCell className="font-mono text-sm">{client.investor_code}</TableCell>
                        <TableCell className="text-sm">{client.rm_name || '-'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(client.exposure)}</TableCell>
                        <TableCell className="text-right">{(client.margin_ratio || 0).toFixed(0)}%</TableCell>
                        <TableCell>{getMarginRatioBadge(client.margin_ratio || 0)}</TableCell>
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
