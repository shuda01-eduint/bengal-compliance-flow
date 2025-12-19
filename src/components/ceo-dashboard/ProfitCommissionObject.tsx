import { Percent, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/balance-utils";
import { cn } from "@/lib/utils";

interface DepartmentPerformance {
  name: string;
  currentPeriod: number;
  previousPeriod: number;
  changePercent: number;
  contributionPercent: number;
  status: "outperform" | "flat" | "underperform";
}

interface InsightBullet {
  text: string;
  type: "positive" | "negative" | "neutral";
}

interface ProfitCommissionObjectProps {
  totalCommission: number;
  monthTarget: number;
  blendedTakeRate: number;
  netRevenue: number;
  departments: DepartmentPerformance[];
  insights: InsightBullet[];
}

export function ProfitCommissionObject({
  totalCommission,
  monthTarget,
  blendedTakeRate,
  netRevenue,
  departments,
  insights,
}: ProfitCommissionObjectProps) {
  const targetAchievement = monthTarget > 0 ? (totalCommission / monthTarget) * 100 : 0;
  const targetStatus =
    targetAchievement >= 100 ? "outperform" : targetAchievement >= 80 ? "flat" : "underperform";

  const statusColors = {
    outperform: "bg-success/20 text-success",
    flat: "bg-warning/20 text-warning",
    underperform: "bg-destructive/20 text-destructive",
  };

  const barColors = {
    outperform: "bg-success",
    flat: "bg-warning",
    underperform: "bg-destructive",
  };

  const maxDeptValue = Math.max(...departments.map((d) => d.currentPeriod), 1);

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 btn-gradient-gold">
            <Percent className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-serif">Profit & Commission</h3>
            <p className="text-sm text-muted-foreground">Revenue performance by department</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          View Full Performance
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Commission MTD</p>
          <p className="text-xl font-semibold text-primary">{formatCurrency(totalCommission)}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("text-xs px-2 py-0.5 rounded-full", statusColors[targetStatus])}>
              {targetAchievement.toFixed(0)}% of target
            </span>
          </div>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Month Target</p>
          <p className="text-xl font-semibold">{formatCurrency(monthTarget)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Gap: {formatCurrency(monthTarget - totalCommission)}
          </p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Net Revenue</p>
          <p className="text-xl font-semibold">{formatCurrency(netRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-2">After rebates</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Blended Take Rate</p>
          <p className="text-xl font-semibold">{blendedTakeRate.toFixed(3)}%</p>
          <p className="text-xs text-muted-foreground mt-2">Commission / Turnover</p>
        </div>
      </div>

      {/* Department Performance Chart */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-muted-foreground mb-3">Commission by Department</h4>
        <div className="space-y-3">
          {departments.slice(0, 6).map((dept) => (
            <div key={dept.name} className="flex items-center gap-4">
              <div className="w-24 text-xs text-muted-foreground truncate" title={dept.name}>
                {dept.name}
              </div>
              <div className="flex-1 h-6 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", barColors[dept.status])}
                  style={{ width: `${(dept.currentPeriod / maxDeptValue) * 100}%` }}
                />
              </div>
              <div className="w-24 text-right">
                <span className="text-sm font-medium">{formatCurrency(dept.currentPeriod)}</span>
              </div>
              <div className="w-16 flex items-center justify-end gap-1">
                {dept.changePercent > 0 ? (
                  <TrendingUp className="h-3 w-3 text-success" />
                ) : dept.changePercent < 0 ? (
                  <TrendingDown className="h-3 w-3 text-destructive" />
                ) : null}
                <span
                  className={cn(
                    "text-xs",
                    dept.changePercent > 0
                      ? "text-success"
                      : dept.changePercent < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {dept.changePercent > 0 ? "+" : ""}
                  {dept.changePercent.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-generated Insights */}
      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-medium text-muted-foreground mb-3">Key Insights</h4>
        <ul className="space-y-2">
          {insights.map((insight, index) => (
            <li
              key={index}
              className={cn(
                "text-sm pl-4 relative before:absolute before:left-0 before:top-2 before:w-2 before:h-2 before:rounded-full",
                insight.type === "positive"
                  ? "text-success before:bg-success"
                  : insight.type === "negative"
                  ? "text-destructive before:bg-destructive"
                  : "text-muted-foreground before:bg-muted-foreground"
              )}
            >
              {insight.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
