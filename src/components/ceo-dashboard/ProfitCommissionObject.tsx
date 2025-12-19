import { Percent, TrendingUp, TrendingDown, ExternalLink, Target } from "lucide-react";
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

  const statusConfig = {
    outperform: { bg: "bg-success/10", text: "text-success", label: "Above Target" },
    flat: { bg: "bg-warning/10", text: "text-warning", label: "On Track" },
    underperform: { bg: "bg-destructive/10", text: "text-destructive", label: "Below Target" },
  };

  const barColors = {
    outperform: "bg-gradient-to-r from-success to-success/70",
    flat: "bg-gradient-to-r from-warning to-warning/70",
    underperform: "bg-gradient-to-r from-destructive to-destructive/70",
  };

  const maxDeptValue = Math.max(...departments.map((d) => d.currentPeriod), 1);

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: "300ms" }}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/30 bg-gradient-to-r from-warning/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="section-header mb-0">
            <div className="section-icon bg-gradient-to-br from-warning to-warning/70">
              <Percent className="h-5 w-5 text-warning-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold font-serif">Profit & Commission</h3>
              <p className="text-xs text-muted-foreground">Revenue performance by department</p>
            </div>
          </div>

          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground h-8">
            Full Report
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-5">
        {/* Summary Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Commission MTD</span>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", statusConfig[targetStatus].bg, statusConfig[targetStatus].text)}>
                {targetAchievement.toFixed(0)}%
              </span>
            </div>
            <p className="text-lg font-bold text-primary">{formatCurrency(totalCommission)}</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-1.5 mb-2">
              <Target className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Target</span>
            </div>
            <p className="text-lg font-bold">{formatCurrency(monthTarget)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Gap: {formatCurrency(Math.abs(monthTarget - totalCommission))}</p>
          </div>

          <div className="stat-card">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Revenue</span>
            <p className="text-lg font-bold mt-2">{formatCurrency(netRevenue)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">After rebates</p>
          </div>

          <div className="stat-card">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Take Rate</span>
            <p className="text-lg font-bold text-accent mt-2">{blendedTakeRate.toFixed(3)}%</p>
            <p className="text-[10px] text-muted-foreground mt-1">Blended</p>
          </div>
        </div>

        {/* Department Performance Chart */}
        <div className="mb-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">By Department</h4>
          <div className="space-y-2.5">
            {departments.slice(0, 5).map((dept, idx) => (
              <div key={dept.name} className="group">
                <div className="flex items-center gap-3">
                  <div className="w-20 text-[11px] text-muted-foreground truncate group-hover:text-foreground transition-colors" title={dept.name}>
                    {dept.name}
                  </div>
                  <div className="flex-1 h-5 bg-secondary/50 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", barColors[dept.status])}
                      style={{ 
                        width: `${(dept.currentPeriod / maxDeptValue) * 100}%`,
                        animationDelay: `${idx * 100}ms`
                      }}
                    />
                  </div>
                  <div className="w-20 text-right">
                    <span className="text-xs font-semibold">{formatCurrency(dept.currentPeriod)}</span>
                  </div>
                  <div className="w-14 flex items-center justify-end gap-1">
                    {dept.changePercent !== 0 && (
                      dept.changePercent > 0 ? (
                        <TrendingUp className="h-3 w-3 text-success" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-destructive" />
                      )
                    )}
                    <span className={cn(
                      "text-[10px] font-medium",
                      dept.changePercent > 0 ? "text-success" : dept.changePercent < 0 ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {dept.changePercent > 0 ? "+" : ""}{dept.changePercent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Key Insights</h4>
          <ul className="space-y-2">
            {insights.slice(0, 3).map((insight, index) => (
              <li
                key={index}
                className={cn(
                  "text-xs pl-3 relative before:absolute before:left-0 before:top-1.5 before:w-1.5 before:h-1.5 before:rounded-full",
                  insight.type === "positive"
                    ? "text-success/90 before:bg-success"
                    : insight.type === "negative"
                    ? "text-destructive/90 before:bg-destructive"
                    : "text-muted-foreground before:bg-muted-foreground"
                )}
              >
                {insight.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
