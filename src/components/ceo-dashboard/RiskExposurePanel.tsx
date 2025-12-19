import { AlertTriangle, Shield, Clock, ExternalLink, ChevronRight } from "lucide-react";
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

  const statusStyles = {
    critical: "bg-destructive/20 text-destructive",
    warning: "bg-warning/20 text-warning",
    ok: "bg-success/20 text-success",
  };

  const riskFlagStyles = {
    High: "bg-destructive/20 text-destructive",
    Watch: "bg-warning/20 text-warning",
    OK: "bg-success/20 text-success",
  };

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "400ms" }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 bg-destructive/20">
            <Shield className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-serif">Risk & Exposure</h3>
            <p className="text-sm text-muted-foreground">Margin, receivables, and risk alerts</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          View Detailed Risk Report
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Aggregate Risk View */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Margin Exposure</p>
          <p className="text-xl font-semibold text-destructive">{formatCurrency(totalMarginExposure)}</p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Utilization %</p>
          <div className="flex items-center gap-2">
            <p className="text-xl font-semibold">{utilizationPercent.toFixed(1)}%</p>
            <Badge className={statusStyles[utilizationStatus]}>
              {utilizationStatus === "critical" ? "Critical" : utilizationStatus === "warning" ? "Warning" : "OK"}
            </Badge>
          </div>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Clients Above Threshold</p>
          <p className={cn("text-xl font-semibold", clientsAboveThreshold > 0 ? "text-destructive" : "text-success")}>
            {clientsAboveThreshold}
          </p>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Negative Ledger Cases</p>
          <p className={cn("text-xl font-semibold", negativeLedgerCount > 0 ? "text-destructive" : "text-success")}>
            {negativeLedgerCount}
          </p>
        </div>
      </div>

      {/* Receivables Aging */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Receivables Aging ({formatCurrency(totalReceivables)} total)
        </h4>
        <div className="grid grid-cols-3 gap-3">
          {agingBuckets.map((bucket) => (
            <div
              key={bucket.range}
              className={cn(
                "rounded-lg p-3 text-center",
                bucket.range.includes("90+")
                  ? "bg-destructive/10 border border-destructive/30"
                  : bucket.range.includes("31-90")
                  ? "bg-warning/10 border border-warning/30"
                  : "bg-success/10 border border-success/30"
              )}
            >
              <p className="text-xs text-muted-foreground">{bucket.range} days</p>
              <p className="text-lg font-semibold">{formatCurrency(bucket.amount)}</p>
              <p className="text-xs text-muted-foreground">{bucket.count} clients</p>
            </div>
          ))}
        </div>
      </div>

      {/* Largest Single Exposure */}
      <div className="bg-secondary/50 rounded-lg p-4 mb-6">
        <p className="text-xs text-muted-foreground mb-1">Largest Single-Name Exposure</p>
        <div className="flex items-center justify-between">
          <span className="font-medium">{largestSingleExposure.investor_code}</span>
          <span className="text-destructive font-semibold">{formatCurrency(largestSingleExposure.amount)}</span>
        </div>
      </div>

      {/* Top 5 Risk Cases */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Top 5 Risk Cases to Review Today
        </h4>
        <div className="space-y-2">
          {topRiskCases.length > 0 ? (
            topRiskCases.map((riskCase) => (
              <div
                key={riskCase.investor_code}
                className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors"
                onClick={() => onViewInvestor?.(riskCase.investor_code)}
              >
                <div className="flex items-center gap-3">
                  <Badge className={riskFlagStyles[riskCase.risk_flag]}>{riskCase.risk_flag}</Badge>
                  <div>
                    <p className="font-medium text-sm">{riskCase.investor_code}</p>
                    <p className="text-xs text-muted-foreground">{riskCase.main_issue}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-destructive">{formatCurrency(riskCase.exposure)}</p>
                    <p className="text-xs text-muted-foreground">{riskCase.recommended_action}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No high-risk cases to review</p>
          )}
        </div>
      </div>
    </div>
  );
}
