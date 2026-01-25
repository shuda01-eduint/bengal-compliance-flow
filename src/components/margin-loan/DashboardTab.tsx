import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Clock,
  Eye,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDetailSheet } from "./ClientDetailSheet";

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

interface TreemapRMData {
  department_name: string;
  rm_name: string;
  rm_id: string;
  margin_outstanding: number;
  portfolio_value: number;
  margin_ratio: number;
  client_count: number;
}

interface TreemapNode {
  name: string;
  size?: number;
  children?: TreemapNode[];
  color?: string;
  margin_ratio?: number;
  client_count?: number;
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
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const pageSize = 15;

  // Fetch dashboard summary via RPC (server-side aggregation)
  const { data: dashboardSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['margin-dashboard-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_dashboard_summary' as any);
      if (error) throw error;
      return (data as DashboardSummary) || defaultSummary;
    }
  });

  // Fetch client accounts for table with pagination
  const { data: clientAccounts, isLoading: loadingAccounts } = useQuery({
    queryKey: ['margin-dashboard-clients', currentPage],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_client_accounts', {
        p_search: '',
        p_account_type: 'all',
        p_statuses: ['all'],
        p_limit: pageSize,
        p_offset: currentPage * pageSize
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch total count for pagination
  const { data: totalCount } = useQuery({
    queryKey: ['margin-dashboard-clients-count'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_client_accounts', {
        p_search: '',
        p_account_type: 'all',
        p_statuses: ['all'],
        p_limit: 100000,
        p_offset: 0
      });
      if (error) throw error;
      return data?.length || 0;
    }
  });

  // Fetch treemap data via RPC
  const { data: treemapData, isLoading: loadingTreemap } = useQuery({
    queryKey: ['margin-treemap-data'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_treemap_data' as any);
      if (error) throw error;
      return (data as TreemapRMData[]) || [];
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

  // Get risk color based on margin ratio
  const getRiskColor = useCallback((marginRatio: number) => {
    if (marginRatio >= 130) return COLORS.safe;
    if (marginRatio >= 110) return COLORS.warning;
    return COLORS.critical;
  }, []);

  // Build treemap data structure grouped by department
  const treemapHierarchy = useMemo(() => {
    if (!treemapData || treemapData.length === 0) return null;

    // Group by department
    const departmentMap = new Map<string, TreemapRMData[]>();
    treemapData.forEach(rm => {
      const dept = rm.department_name || 'Unassigned';
      if (!departmentMap.has(dept)) {
        departmentMap.set(dept, []);
      }
      departmentMap.get(dept)!.push(rm);
    });

    // Build hierarchical structure
    const children: TreemapNode[] = Array.from(departmentMap.entries()).map(([deptName, rms]) => ({
      name: deptName,
      children: rms.map(rm => ({
        name: rm.rm_name || 'Unknown',
        size: Number(rm.margin_outstanding) || 1,
        color: getRiskColor(Number(rm.margin_ratio) || 0),
        margin_ratio: Number(rm.margin_ratio) || 0,
        client_count: Number(rm.client_count) || 0
      }))
    }));

    return { name: 'root', children };
  }, [treemapData, getRiskColor]);

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (absValue >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getMarginRatioBadge = (ratio: number) => {
    if (ratio >= 130) return <Badge className="bg-green-500/20 text-green-400">Safe</Badge>;
    if (ratio >= 110) return <Badge className="bg-yellow-500/20 text-yellow-400">Warning</Badge>;
    return <Badge className="bg-red-500/20 text-red-400">Critical</Badge>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'negative_equity':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Negative Equity</Badge>;
      case 'critical':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Critical</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Suspended</Badge>;
      case 'active':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
      case 'closed':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const totalPages = Math.ceil((totalCount || 0) / pageSize);

  // Custom content renderer for treemap cells
  const CustomTreemapContent = (props: any) => {
    const { x, y, width, height, name, color, depth } = props;
    
    if (depth === 1) {
      // Department level - show label only
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            style={{
              fill: 'hsl(var(--muted))',
              stroke: 'hsl(var(--border))',
              strokeWidth: 2,
            }}
          />
          {width > 60 && height > 20 && (
            <text
              x={x + 6}
              y={y + 16}
              fill="hsl(var(--muted-foreground))"
              fontSize={11}
              fontWeight="bold"
            >
              {name}
            </text>
          )}
        </g>
      );
    }
    
    if (depth === 2) {
      // RM level - colored box
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            style={{
              fill: color,
              stroke: 'hsl(var(--background))',
              strokeWidth: 1,
              opacity: 0.85,
            }}
          />
          {width > 40 && height > 25 && (
            <text
              x={x + width / 2}
              y={y + height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fff"
              fontSize={10}
              fontWeight="500"
            >
              {name.length > 12 ? name.substring(0, 10) + '...' : name}
            </text>
          )}
        </g>
      );
    }
    
    return null;
  };

  // Custom tooltip for treemap
  const TreemapTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0].payload;
    if (!data.size) return null; // Skip department-level tooltips
    
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          Margin Outstanding: {formatCurrency(data.size)}
        </p>
        <p className="text-sm text-muted-foreground">
          Margin Ratio: {(data.margin_ratio || 0).toFixed(0)}%
        </p>
        <p className="text-sm text-muted-foreground">
          Clients: {data.client_count || 0}
        </p>
      </div>
    );
  };

  const isLoading = loadingSummary || loadingCalls || loadingTreemap || loadingAccounts;

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

      {/* Full-width Treemap Row */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Margin Health Distribution</CardTitle>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.safe }} />
                <span className="text-muted-foreground">Safe (&gt;130%)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.warning }} />
                <span className="text-muted-foreground">Warning (110-130%)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.critical }} />
                <span className="text-muted-foreground">Critical (&lt;110%)</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Skeleton className="h-full w-full rounded" />
              </div>
            ) : treemapHierarchy && treemapHierarchy.children && treemapHierarchy.children.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={treemapHierarchy.children}
                  dataKey="size"
                  aspectRatio={4 / 3}
                  stroke="hsl(var(--border))"
                  content={<CustomTreemapContent />}
                >
                  <Tooltip content={<TreemapTooltip />} />
                </Treemap>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No margin account data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Client Margin Accounts Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Client Margin Accounts</CardTitle>
            <div className="text-sm text-muted-foreground">
              Showing {clientAccounts?.length || 0} of {totalCount || 0} accounts
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAccounts ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Investor Code</TableHead>
                      <TableHead>Investor Name</TableHead>
                      <TableHead>RM Name</TableHead>
                      <TableHead className="text-right">Margin Loan</TableHead>
                      <TableHead className="text-right">Accrued Interest</TableHead>
                      <TableHead className="text-right">Portfolio Value</TableHead>
                      <TableHead className="text-right">Equity</TableHead>
                      <TableHead className="text-right">Margin Ratio %</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientAccounts && clientAccounts.length > 0 ? clientAccounts.map((account: any) => (
                      <TableRow key={account.investor_code}>
                        <TableCell className="font-mono font-medium">
                          {account.investor_code}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {account.investor_name || '-'}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {account.rm_name || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(account.current_exposure || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(account.accrued_interest || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(account.portfolio_value || 0)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${(account.equity || 0) < 0 ? 'text-red-400' : ''}`}>
                          {formatCurrency(account.equity || 0)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {(account.margin_ratio || 0).toFixed(2)}%
                        </TableCell>
                        <TableCell>{getStatusBadge(account.status || 'active')}</TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedClient(account.investor_code)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          No margin accounts found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage + 1} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={currentPage >= totalPages - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Client Detail Sheet */}
      <ClientDetailSheet
        investorCode={selectedClient}
        open={!!selectedClient}
        onOpenChange={(open) => !open && setSelectedClient(null)}
      />
    </div>
  );
}
