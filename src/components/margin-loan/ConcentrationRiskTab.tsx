import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Users, TrendingUp, PieChart } from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

// Colors for chart
const CHART_COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"
];

export function ConcentrationRiskTab() {
  // Mock data for client exposure
  const mockClientExposure = [
    { name: "ABC Holdings", exposure: 25, code: "INV001" },
    { name: "XYZ Capital", exposure: 18, code: "INV002" },
    { name: "Global Traders", exposure: 15, code: "INV003" },
    { name: "Prime Invest", exposure: 12, code: "INV004" },
    { name: "Delta Finance", exposure: 10, code: "INV005" },
    { name: "Alpha Corp", exposure: 8, code: "INV006" },
    { name: "Beta Ltd", exposure: 5, code: "INV007" },
    { name: "Gamma Inc", exposure: 4, code: "INV008" },
    { name: "Omega Holdings", exposure: 2, code: "INV009" },
    { name: "Sigma Capital", exposure: 1, code: "INV010" },
  ];

  // Mock data for security exposure
  const mockSecurityExposure = [
    { trading_code: "BEXIMCO", exposure: 15.5, value: 45000000, clients: 125 },
    { trading_code: "SQURPHARMA", exposure: 12.3, value: 36000000, clients: 98 },
    { trading_code: "BRAC BANK", exposure: 10.8, value: 31500000, clients: 87 },
    { trading_code: "GP", exposure: 8.5, value: 24800000, clients: 156 },
    { trading_code: "RENATA", exposure: 7.2, value: 21000000, clients: 64 },
    { trading_code: "ICB", exposure: 6.1, value: 17800000, clients: 72 },
    { trading_code: "WALTON", exposure: 5.4, value: 15700000, clients: 45 },
    { trading_code: "LHBL", exposure: 4.8, value: 14000000, clients: 38 },
  ];

  const formatCurrency = (value: number) => {
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getExposureBadge = (exposure: number) => {
    if (exposure >= 15) return <Badge className="bg-red-500/20 text-red-400">High</Badge>;
    if (exposure >= 10) return <Badge className="bg-yellow-500/20 text-yellow-400">Medium</Badge>;
    return <Badge className="bg-green-500/20 text-green-400">Low</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Risk Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Largest Client Exposure
            </CardTitle>
            <Users className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">25%</div>
            <p className="text-xs text-muted-foreground mt-1">
              ABC Holdings Ltd
            </p>
            <Badge className="mt-2 bg-yellow-500/20 text-yellow-400">
              Above 20% threshold
            </Badge>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Largest Security Exposure
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">15.5%</div>
            <p className="text-xs text-muted-foreground mt-1">
              BEXIMCO
            </p>
            <Badge className="mt-2 bg-yellow-500/20 text-yellow-400">
              Monitor closely
            </Badge>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              High Concentration Clients
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">4</div>
            <p className="text-xs text-muted-foreground mt-1">
              Clients &gt;10% exposure
            </p>
            <Badge className="mt-2 bg-red-500/20 text-red-400">
              Requires review
            </Badge>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Diversification Score
            </CardTitle>
            <PieChart className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">68/100</div>
            <p className="text-xs text-muted-foreground mt-1">
              Portfolio diversification index
            </p>
            <Badge className="mt-2 bg-green-500/20 text-green-400">
              Good
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Client Exposure Chart */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Top 10 Clients by Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={mockClientExposure}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    type="number" 
                    domain={[0, 30]}
                    tickFormatter={(value) => `${value}%`}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={75}
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      borderColor: 'hsl(var(--border))',
                      color: 'hsl(var(--foreground))'
                    }}
                    formatter={(value: number) => [`${value}%`, 'Exposure']}
                  />
                  <Bar dataKey="exposure" radius={[0, 4, 4, 0]}>
                    {mockClientExposure.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.exposure >= 15 ? '#ef4444' : entry.exposure >= 10 ? '#f59e0b' : '#10b981'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Security Exposure Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Single Security Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Security</TableHead>
                    <TableHead className="text-right">Exposure %</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockSecurityExposure.map((security) => (
                    <TableRow key={security.trading_code}>
                      <TableCell className="font-mono font-medium">
                        {security.trading_code}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {security.exposure.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(security.value)}
                      </TableCell>
                      <TableCell className="text-right">
                        {security.clients}
                      </TableCell>
                      <TableCell>
                        {getExposureBadge(security.exposure)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Concentration Limits Info */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Regulatory Concentration Limits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-muted/50">
              <h4 className="font-medium mb-2">Single Client Limit</h4>
              <p className="text-muted-foreground">
                Maximum 20% of core capital per single client exposure
              </p>
              <Badge className="mt-2" variant="outline">BSEC Regulation</Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <h4 className="font-medium mb-2">Single Security Limit</h4>
              <p className="text-muted-foreground">
                Maximum 15% of margin book in single security
              </p>
              <Badge className="mt-2" variant="outline">Internal Policy</Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <h4 className="font-medium mb-2">Sector Concentration</h4>
              <p className="text-muted-foreground">
                Maximum 25% exposure to any single sector
              </p>
              <Badge className="mt-2" variant="outline">Risk Guideline</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
