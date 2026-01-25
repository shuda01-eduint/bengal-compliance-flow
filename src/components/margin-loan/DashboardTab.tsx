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

// Mock data - replace with real queries when data exists
const mockHealthData = [
  { name: "Safe (>130%)", value: 45, color: COLORS.safe },
  { name: "Warning (110-130%)", value: 35, color: COLORS.warning },
  { name: "Critical (<110%)", value: 20, color: COLORS.critical }
];

const mockTopClients = [
  { code: "INV001", name: "ABC Holdings Ltd", exposure: 25000000, limit: 30000000, ratio: 145 },
  { code: "INV002", name: "XYZ Capital", exposure: 18500000, limit: 25000000, ratio: 128 },
  { code: "INV003", name: "Global Traders", exposure: 15200000, limit: 20000000, ratio: 115 },
  { code: "INV004", name: "Prime Investments", exposure: 12800000, limit: 15000000, ratio: 108 },
  { code: "INV005", name: "Delta Finance", exposure: 10500000, limit: 12000000, ratio: 135 },
];

export function DashboardTab() {
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
            {loadingSummary ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(accountsSummary?.totalExposure || 0)}
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
            {loadingSummary ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {formatCurrency(accountsSummary?.totalLimit || 0)}
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
            {loadingSummary ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-foreground">
                {accountsSummary?.avgUtilization?.toFixed(1) || 0}%
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
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {loadingCalls ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-foreground">{marginCallsCount}</span>
                {marginCallsCount > 0 && (
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
            <Users className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">12</div>
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
            <div className="text-2xl font-bold text-foreground">
              {formatCurrency(150000000)}
            </div>
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
            <div className="text-2xl font-bold text-foreground">142%</div>
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
            <div className="text-2xl font-bold text-foreground">
              {formatCurrency(2500000)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              This month
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
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mockHealthData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {mockHealthData.map((entry, index) => (
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Exposure</TableHead>
                    <TableHead className="text-right">Ratio</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockTopClients.map((client) => (
                    <TableRow key={client.code}>
                      <TableCell className="font-mono text-sm">{client.code}</TableCell>
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell className="text-right">{formatCurrency(client.exposure)}</TableCell>
                      <TableCell className="text-right">{client.ratio}%</TableCell>
                      <TableCell>{getMarginRatioBadge(client.ratio)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
