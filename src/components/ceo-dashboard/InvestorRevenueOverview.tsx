import { useState } from "react";
import { Users, TrendingUp, UserPlus, UserMinus, DollarSign, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/balance-utils";
import { cn } from "@/lib/utils";

interface TopClient {
  investor_code: string;
  investor_name: string;
  revenue: number;
  share_percent: number;
}

interface InvestorRevenueOverviewProps {
  activeInvestors: number;
  newInvestors: number;
  churnedInvestors: number;
  arpu: number;
  totalRevenue: number;
  topClients: TopClient[];
  departments: { name: string; code: string }[];
  branches: { name: string; code: string }[];
  onFilterChange?: (filters: { department?: string; branch?: string }) => void;
}

export function InvestorRevenueOverview({
  activeInvestors,
  newInvestors,
  churnedInvestors,
  arpu,
  totalRevenue,
  topClients,
  departments,
  branches,
  onFilterChange,
}: InvestorRevenueOverviewProps) {
  const [department, setDepartment] = useState<string>("all");
  const [branch, setBranch] = useState<string>("all");

  const handleDepartmentChange = (value: string) => {
    setDepartment(value);
    onFilterChange?.({ department: value === "all" ? undefined : value, branch: branch === "all" ? undefined : branch });
  };

  const handleBranchChange = (value: string) => {
    setBranch(value);
    onFilterChange?.({ department: department === "all" ? undefined : department, branch: value === "all" ? undefined : value });
  };

  const metrics = [
    { label: "Active Investors", value: activeInvestors.toLocaleString(), icon: Users, color: "text-primary", bgColor: "bg-primary/10" },
    { label: "New This Period", value: `+${newInvestors.toLocaleString()}`, icon: UserPlus, color: "text-success", bgColor: "bg-success/10" },
    { label: "Churned", value: `-${churnedInvestors.toLocaleString()}`, icon: UserMinus, color: "text-destructive", bgColor: "bg-destructive/10" },
    { label: "ARPU", value: formatCurrency(arpu), icon: DollarSign, color: "text-accent", bgColor: "bg-accent/10" },
    { label: "Total Revenue", value: formatCurrency(totalRevenue), icon: TrendingUp, color: "text-primary", bgColor: "bg-primary/10" },
  ];

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: "200ms" }}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="section-header mb-0">
            <div className="section-icon bg-gradient-to-br from-primary to-primary/70">
              <Users className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold font-serif">Investor & Revenue</h3>
              <p className="text-xs text-muted-foreground">Account metrics and distribution</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={department} onValueChange={handleDepartmentChange}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-secondary/50 border-border/50">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={branch} onValueChange={handleBranchChange}>
              <SelectTrigger className="w-[120px] h-8 text-xs bg-secondary/50 border-border/50">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {metrics.map((metric) => (
            <div key={metric.label} className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("rounded-md p-1.5", metric.bgColor)}>
                  <metric.icon className={cn("h-3.5 w-3.5", metric.color)} />
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{metric.label}</span>
              </div>
              <p className={cn("text-lg font-bold", metric.color)}>{metric.value}</p>
            </div>
          ))}
        </div>

        {/* Top 5 Clients */}
        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Top 5 Clients by Revenue</h4>
          <div className="flex flex-wrap gap-2">
            {topClients.length > 0 ? (
              topClients.map((client, index) => (
                <Badge
                  key={client.investor_code}
                  variant="outline"
                  className="px-3 py-2 cursor-pointer hover:bg-secondary/80 transition-all hover:-translate-y-0.5 border-border/50"
                >
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center mr-2">
                    {index + 1}
                  </span>
                  <span className="font-medium text-sm">{client.investor_code}</span>
                  <span className="mx-2 text-border">|</span>
                  <span className="text-primary font-semibold">{formatCurrency(client.revenue)}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                    {client.share_percent.toFixed(1)}%
                  </span>
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No client data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
