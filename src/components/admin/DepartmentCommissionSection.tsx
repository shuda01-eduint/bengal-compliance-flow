import { useState, useMemo } from "react";
import { Percent, ChevronDown, ChevronRight, Download, Mail, Filter } from "lucide-react";
import { formatCurrency } from "@/lib/balance-utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface DepartmentData {
  name: string;
  total: number;
  count: number;
  percentage: number;
}

interface BalanceRow {
  investor_code: string;
  rm_email: string | null;
  rm_name: string | null;
  total_mv: number;
  brokerage_amount: number;
  adjusted_ledger: number;
}

interface DepartmentCommissionSectionProps {
  departments: DepartmentData[];
  totalBrokerage: number;
  balanceData?: BalanceRow[];
  emailToDepartmentMap: Record<string, string>;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(210, 70%, 50%)',
  'hsl(280, 60%, 50%)',
];

export function DepartmentCommissionSection({ 
  departments, 
  totalBrokerage, 
  balanceData = [],
  emailToDepartmentMap 
}: DepartmentCommissionSectionProps) {
  const [timeRange, setTimeRange] = useState("mtd");
  const [showAllDepts, setShowAllDepts] = useState(false);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const topDepartments = departments.slice(0, 8);
  const remainingDepartments = departments.slice(8);

  const chartData = topDepartments.map((dept, index) => ({
    name: dept.name.length > 15 ? dept.name.substring(0, 15) + '...' : dept.name,
    fullName: dept.name,
    value: dept.total,
    percentage: dept.percentage,
    clients: dept.count,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));

  const handleDeptClick = (deptName: string) => {
    setSelectedDept(deptName);
    setDrilldownOpen(true);
  };

  const deptClients = useMemo(() => {
    if (!selectedDept || !balanceData) return [];
    
    // Get unique investors for this department
    const seen = new Set<string>();
    const clients = balanceData.filter(row => {
      if (seen.has(row.investor_code)) return false;
      const dept = row.rm_email ? emailToDepartmentMap[row.rm_email.toLowerCase()] : null;
      if ((dept || 'Unassigned') !== selectedDept) return false;
      seen.add(row.investor_code);
      return true;
    });

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return clients.filter(c => 
        c.investor_code.toLowerCase().includes(q) ||
        c.rm_name?.toLowerCase().includes(q)
      );
    }

    return clients;
  }, [selectedDept, balanceData, emailToDepartmentMap, searchQuery]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground">{data.fullName}</p>
          <p className="text-primary font-semibold">{formatCurrency(data.value)}</p>
          <p className="text-xs text-muted-foreground">
            {data.percentage.toFixed(1)}% of total • {data.clients} clients
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-card rounded-xl p-4">
      {/* Header with filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Brokerage Commission by Department</span>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{formatCurrency(totalBrokerage)}</span>
          </span>
          
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="mtd">MTD</SelectItem>
              <SelectItem value="ytd">YTD</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {departments.length > 0 ? (
        <>
          {/* Bar Chart for Top 8 */}
          <div className="h-[200px] mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
                <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={120}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar 
                  dataKey="value" 
                  radius={[0, 4, 4, 0]}
                  onClick={(data) => handleDeptClick(data.fullName)}
                  className="cursor-pointer"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Row for Top 8 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {topDepartments.slice(0, 4).map((dept) => (
              <div 
                key={dept.name}
                className="bg-secondary/50 rounded-lg p-3 cursor-pointer hover:bg-secondary/80 transition-colors"
                onClick={() => handleDeptClick(dept.name)}
              >
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

          {/* Expandable Table for Remaining */}
          {remainingDepartments.length > 0 && (
            <div className="border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllDepts(!showAllDepts)}
                className="mb-2"
              >
                {showAllDepts ? (
                  <ChevronDown className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                {showAllDepts ? 'Hide' : 'Show'} {remainingDepartments.length} more departments
              </Button>
              
              {showAllDepts && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">% of Total</TableHead>
                      <TableHead className="text-right">Clients</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {remainingDepartments.map((dept) => (
                      <TableRow 
                        key={dept.name}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleDeptClick(dept.name)}
                      >
                        <TableCell className="font-medium">{dept.name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(dept.total)}</TableCell>
                        <TableCell className="text-right">{dept.percentage.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">{dept.count}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">No brokerage data available</p>
      )}

      {/* Department Drilldown Modal */}
      <Dialog open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{selectedDept}</span>
              <span className="text-sm font-normal text-muted-foreground">
                ({deptClients.length} clients)
              </span>
            </DialogTitle>
          </DialogHeader>
          
          {/* Filters & Actions */}
          <div className="flex items-center gap-3 pb-4 border-b">
            <div className="relative flex-1">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by investor code or RM..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button variant="outline" size="sm">
              <Mail className="h-4 w-4 mr-1" />
              Email Summary
            </Button>
          </div>

          {/* Client Table */}
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Investor Code</TableHead>
                  <TableHead>RM Name</TableHead>
                  <TableHead className="text-right">Market Value</TableHead>
                  <TableHead className="text-right">Brokerage</TableHead>
                  <TableHead className="text-right">Adjusted Ledger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptClients.slice(0, 100).map((client, idx) => (
                  <TableRow key={`${client.investor_code}-${idx}`}>
                    <TableCell className="font-medium">{client.investor_code}</TableCell>
                    <TableCell>{client.rm_name || '-'}</TableCell>
                    <TableCell className="text-right">{formatCurrency(client.total_mv)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(client.brokerage_amount)}</TableCell>
                    <TableCell className={cn("text-right", client.adjusted_ledger < 0 && "text-destructive")}>
                      {formatCurrency(client.adjusted_ledger)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {deptClients.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                No clients found
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Showing {Math.min(deptClients.length, 100)} of {deptClients.length} clients
            </span>
            <Button variant="outline" onClick={() => setDrilldownOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
