import { AlertTriangle, Shield, Clock, ExternalLink, ChevronRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/balance-utils";
import { cn } from "@/lib/utils";

interface AgingBucket {
  range: string;
  amount: number;
  count: number;
}

interface RiskCase {
  investor_code: string;
  investor_name: string;
  exposure: number;
  risk_flag: "High" | "Watch" | "OK";
  main_issue: string;
  recommended_action: string;
}

interface RiskExposurePanelProps {
  totalMarginExposure: number;
  utilizationPercent: number;
  clientsAboveThreshold: number;
  totalReceivables: number;
  agingBuckets: AgingBucket[];
  negativeLedgerCount: number;
  largestSingleExposure: { investor_code: string; amount: number };
  topRiskCases: RiskCase[];
  onViewInvestor?: (investorCode: string) => void;
}

export function RiskExposurePanel({
  totalMarginExposure,
  utilizationPercent,
  clientsAboveThreshold,
  totalReceivables,
  agingBuckets,
  negativeLedgerCount,
  largestSingleExposure,
  topRiskCases,
  onViewInvestor,
}: RiskExposurePanelProps) {
  const utilizationStatus =
    utilizationPercent >= 90 ? "critical" : utilizationPercent >= 70 ? "warning" : "ok";

  const statusConfig = {
    critical: { bg: "bg-destructive/10", text: "text-destructive", label: "Critical" },
    warning: { bg: "bg-warning/10", text: "text-warning", label: "Warning" },
    ok: { bg: "bg-success/10", text: "text-success", label: "OK" },
  };

  const riskFlagConfig = {
    High: { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/30" },
    Watch: { bg: "bg-warning/15", text: "text-warning", border: "border-warning/30" },
    OK: { bg: "bg-success/15", text: "text-success", border: "border-success/30" },
  };

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: "400ms" }}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/30 bg-gradient-to-r from-destructive/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="section-header mb-0">
            <div className="section-icon bg-gradient-to-br from-destructive to-destructive/70">
              <Shield className="h-5 w-5 text-destructive-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold font-serif">Risk & Exposure</h3>
              <p className="text-xs text-muted-foreground">Margin, receivables, and alerts</p>
            </div>
          </div>

          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground h-8">
            Risk Report
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-5">
        {/* Aggregate Risk */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="stat-card border-l-2 border-destructive">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin Exposure</span>
            <p className="text-lg font-bold text-destructive mt-2">{formatCurrency(totalMarginExposure)}</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Utilization</span>
              <Badge className={cn("text-[10px] h-5", statusConfig[utilizationStatus].bg, statusConfig[utilizationStatus].text)}>
                {statusConfig[utilizationStatus].label}
              </Badge>
            </div>
            <p className="text-lg font-bold">{utilizationPercent.toFixed(1)}%</p>
          </div>

          <div className="stat-card">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Above Threshold</span>
            <p className={cn("text-lg font-bold mt-2", clientsAboveThreshold > 0 ? "text-destructive" : "text-success")}>
              {clientsAboveThreshold}
            </p>
          </div>

          <div className="stat-card">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Negative Ledger</span>
            <p className={cn("text-lg font-bold mt-2", negativeLedgerCount > 0 ? "text-destructive" : "text-success")}>
              {negativeLedgerCount}
            </p>
          </div>
        </div>

        {/* Receivables Aging */}
        <div className="mb-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Receivables Aging • {formatCurrency(totalReceivables)}
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {agingBuckets.map((bucket) => {
              const isOverdue = bucket.range.includes("90+");
              const isWarning = bucket.range.includes("31-90");
              return (
                <div
                  key={bucket.range}
                  className={cn(
                    "rounded-lg p-3 text-center border transition-all hover:-translate-y-0.5",
                    isOverdue
                      ? "bg-destructive/5 border-destructive/20 hover:border-destructive/40"
                      : isWarning
                      ? "bg-warning/5 border-warning/20 hover:border-warning/40"
                      : "bg-success/5 border-success/20 hover:border-success/40"
                  )}
                >
                  <p className={cn(
                    "text-[10px] font-medium uppercase tracking-wider",
                    isOverdue ? "text-destructive" : isWarning ? "text-warning" : "text-success"
                  )}>
                    {bucket.range} days
                  </p>
                  <p className="text-base font-bold mt-1">{formatCurrency(bucket.amount)}</p>
                  <p className="text-[10px] text-muted-foreground">{bucket.count} clients</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Largest Exposure */}
        <div className="stat-card mb-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Largest Single Exposure</span>
            <p className="font-medium mt-1">{largestSingleExposure.investor_code}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-destructive">{formatCurrency(largestSingleExposure.amount)}</p>
          </div>
        </div>

        {/* Top Risk Cases */}
        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            Top Risk Cases to Review
          </h4>
          <div className="space-y-2">
            {topRiskCases.length > 0 ? (
              topRiskCases.slice(0, 4).map((riskCase) => (
                <div
                  key={riskCase.investor_code}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:-translate-y-0.5",
                    riskFlagConfig[riskCase.risk_flag].bg,
                    riskFlagConfig[riskCase.risk_flag].border
                  )}
                  onClick={() => onViewInvestor?.(riskCase.investor_code)}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cn("text-[10px] h-5 border", riskFlagConfig[riskCase.risk_flag].text, riskFlagConfig[riskCase.risk_flag].border)}>
                      {riskCase.risk_flag}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">{riskCase.investor_code}</p>
                      <p className="text-[10px] text-muted-foreground">{riskCase.main_issue}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-destructive">{formatCurrency(riskCase.exposure)}</p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground bg-success/5 rounded-lg border border-success/20">
                <TrendingUp className="h-5 w-5 text-success mx-auto mb-2" />
                No high-risk cases
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
