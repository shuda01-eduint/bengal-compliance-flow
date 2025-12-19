import { useState } from "react";
import { Users, TrendingUp, TrendingDown, UserPlus, UserMinus, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/balance-utils";

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

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "200ms" }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 btn-gradient-gold">
            <Users className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-serif">Investor & Revenue Overview</h3>
            <p className="text-sm text-muted-foreground">Active accounts and revenue distribution</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={department} onValueChange={handleDepartmentChange}>
            <SelectTrigger className="w-[160px] bg-secondary border-border">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.code} value={d.code}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={branch} onValueChange={handleBranchChange}>
            <SelectTrigger className="w-[140px] bg-secondary border-border">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">Active Investors</span>
          </div>
          <p className="text-xl font-semibold">{activeInvestors.toLocaleString()}</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="h-4 w-4 text-success" />
            <span className="text-xs text-muted-foreground">New This Period</span>
          </div>
          <p className="text-xl font-semibold text-success">+{newInvestors.toLocaleString()}</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <UserMinus className="h-4 w-4 text-destructive" />
            <span className="text-xs text-muted-foreground">Churned</span>
          </div>
          <p className="text-xl font-semibold text-destructive">-{churnedInvestors.toLocaleString()}</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-accent" />
            <span className="text-xs text-muted-foreground">ARPU</span>
          </div>
          <p className="text-xl font-semibold text-accent">{formatCurrency(arpu)}</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">Total Revenue</span>
          </div>
          <p className="text-xl font-semibold text-primary">{formatCurrency(totalRevenue)}</p>
        </div>
      </div>

      {/* Top 5 Clients */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-3">Top 5 Clients by Revenue</h4>
        <div className="flex flex-wrap gap-2">
          {topClients.length > 0 ? (
            topClients.map((client, index) => (
              <Badge
                key={client.investor_code}
                variant="outline"
                className="px-3 py-2 cursor-pointer hover:bg-secondary transition-colors"
              >
                <span className="text-xs text-muted-foreground mr-2">#{index + 1}</span>
                <span className="font-medium">{client.investor_code}</span>
                <span className="mx-2 text-muted-foreground">•</span>
                <span className="text-primary">{formatCurrency(client.revenue)}</span>
                <span className="ml-2 text-xs text-muted-foreground">({client.share_percent.toFixed(1)}%)</span>
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No client data available</p>
          )}
        </div>
      </div>
    </div>
  );
}
