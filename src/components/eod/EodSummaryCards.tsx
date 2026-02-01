import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Users, FileText, AlertTriangle, Percent, DollarSign, BarChart3, Building2, ArrowUpDown, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface EodSummaryCardsProps {
  totalTrades?: number;
  clientsCaptured?: number;
  grossBuy?: number;
  grossSell?: number;
  totalCommission?: number;
  totalDeposits?: number;
  totalWithdrawals?: number;
  errorsCount?: number;
  warningsCount?: number;
  // New props for enhanced metrics
  positionsCaptured?: number;
  totalMarketValue?: number;
  marginAccounts?: number;
  marginExposure?: number;
  dailyInterestTotal?: number;
  totalEquity?: number;
  negativeEquityCount?: number;
  visible?: boolean;
}

export function EodSummaryCards({
  totalTrades = 0,
  clientsCaptured = 0,
  grossBuy = 0,
  grossSell = 0,
  totalCommission = 0,
  totalDeposits = 0,
  totalWithdrawals = 0,
  errorsCount = 0,
  warningsCount = 0,
  positionsCaptured = 0,
  totalMarketValue = 0,
  marginAccounts = 0,
  marginExposure = 0,
  dailyInterestTotal = 0,
  totalEquity = 0,
  negativeEquityCount = 0,
  visible = true,
}: EodSummaryCardsProps) {
  if (!visible) return null;

  const formatCurrency = (value: number): string => {
    if (value >= 1e9) {
      return `${(value / 1e9).toFixed(2)}B`;
    }
    if (value >= 1e6) {
      return `${(value / 1e6).toFixed(2)}M`;
    }
    if (value >= 1e3) {
      return `${(value / 1e3).toFixed(1)}K`;
    }
    return value.toLocaleString();
  };

  const netCashFlow = totalDeposits - totalWithdrawals;

  const tradingCards = [
    {
      title: "Total Trades",
      value: totalTrades.toLocaleString(),
      icon: FileText,
      color: "text-foreground",
    },
    {
      title: "Clients Captured",
      value: clientsCaptured.toLocaleString(),
      icon: Users,
      color: "text-foreground",
    },
    {
      title: "Gross Buy",
      value: `৳${formatCurrency(grossBuy)}`,
      icon: TrendingDown,
      color: "text-red-600",
    },
    {
      title: "Gross Sell",
      value: `৳${formatCurrency(grossSell)}`,
      icon: TrendingUp,
      color: "text-green-600",
    },
    {
      title: "Commission",
      value: `৳${formatCurrency(totalCommission)}`,
      icon: TrendingUp,
      color: "text-primary",
    },
  ];

  // Cash Flow Card - combines deposits and withdrawals into one modern card
  const cashFlowCard = {
    deposits: totalDeposits,
    withdrawals: totalWithdrawals,
    netFlow: netCashFlow,
  };

  const marginCards = [
    {
      title: "Positions",
      value: positionsCaptured.toLocaleString(),
      icon: BarChart3,
      color: "text-foreground",
    },
    {
      title: "Total MV",
      value: `৳${formatCurrency(totalMarketValue)}`,
      icon: DollarSign,
      color: "text-primary",
    },
    {
      title: "Margin Accounts",
      value: marginAccounts.toLocaleString(),
      icon: Building2,
      color: "text-amber-600",
    },
    {
      title: "Margin Exposure",
      value: `৳${formatCurrency(marginExposure)}`,
      icon: TrendingDown,
      color: "text-red-600",
    },
    {
      title: "Daily Interest",
      value: `৳${formatCurrency(dailyInterestTotal)}`,
      icon: Percent,
      color: "text-amber-600",
    },
    {
      title: "Total Equity",
      value: `৳${formatCurrency(totalEquity)}`,
      icon: TrendingUp,
      color: totalEquity >= 0 ? "text-green-600" : "text-red-600",
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">EOD Summary</h3>
      
      {/* Trading Cards - 5 cards in a row */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {tradingCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className={cn("h-4 w-4", card.color)} />
            </CardHeader>
            <CardContent>
              <div className={cn("text-lg font-bold", card.color)}>
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cash Flow Card - Modern combined deposits/withdrawals */}
      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        <Card className="bg-gradient-to-br from-card to-muted/30 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ArrowUpDown className="h-4 w-4" />
              Cash Flow Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {/* Deposits */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowUpRight className="h-3 w-3 text-green-500" />
                  Deposits
                </div>
                <div className="text-xl font-bold text-green-600">
                  ৳{formatCurrency(cashFlowCard.deposits)}
                </div>
              </div>
              
              {/* Withdrawals */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowDownRight className="h-3 w-3 text-red-500" />
                  Withdrawals
                </div>
                <div className="text-xl font-bold text-red-600">
                  ৳{formatCurrency(cashFlowCard.withdrawals)}
                </div>
              </div>
              
              {/* Net Flow */}
              <div className="space-y-1 border-l pl-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {cashFlowCard.netFlow >= 0 ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  Net Flow
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  cashFlowCard.netFlow >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {cashFlowCard.netFlow >= 0 ? "+" : "-"}৳{formatCurrency(Math.abs(cashFlowCard.netFlow))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Margin & Position Cards */}
      {(positionsCaptured > 0 || totalMarketValue > 0) && (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {marginCards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <card.icon className={cn("h-4 w-4", card.color)} />
              </CardHeader>
              <CardContent>
                <div className={cn("text-lg font-bold", card.color)}>
                  {card.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(errorsCount > 0 || warningsCount > 0 || negativeEquityCount > 0) && (
        <div className="flex gap-4">
          {errorsCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {errorsCount} error{errorsCount !== 1 ? "s" : ""}
            </div>
          )}
          {warningsCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              {warningsCount} warning{warningsCount !== 1 ? "s" : ""}
            </div>
          )}
          {negativeEquityCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {negativeEquityCount} account{negativeEquityCount !== 1 ? "s" : ""} with negative equity
            </div>
          )}
        </div>
      )}
    </div>
  );
}
