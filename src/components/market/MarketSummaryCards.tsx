import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, BarChart3, Building2 } from "lucide-react";
import { StockDaily } from "@/hooks/useMarketData";

interface MarketSummaryCardsProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

export function MarketSummaryCards({ stocks, isLoading }: MarketSummaryCardsProps) {
  const totalStocks = stocks.length;
  
  const gainers = stocks.filter(s => (s.change || 0) > 0);
  const losers = stocks.filter(s => (s.change || 0) < 0);
  
  const topGainer = gainers.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))[0];
  const topLoser = losers.sort((a, b) => (a.change_pct || 0) - (b.change_pct || 0))[0];
  
  const totalMarketCap = stocks.reduce((sum, s) => sum + (s.market_cap || 0), 0);
  
  const formatMarketCap = (value: number) => {
    if (value >= 1e12) return `৳${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `৳${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `৳${(value / 1e6).toFixed(2)}M`;
    return `৳${value.toLocaleString()}`;
  };

  const cards = [
    {
      title: "Total Stocks",
      value: isLoading ? "..." : totalStocks.toString(),
      description: "Active instruments",
      icon: BarChart3,
      color: "text-primary",
    },
    {
      title: "Top Gainer",
      value: isLoading ? "..." : topGainer?.code || "N/A",
      description: topGainer ? `+${topGainer.change_pct?.toFixed(2)}%` : "No gainers",
      icon: TrendingUp,
      color: "text-green-500",
    },
    {
      title: "Top Loser",
      value: isLoading ? "..." : topLoser?.code || "N/A",
      description: topLoser ? `${topLoser.change_pct?.toFixed(2)}%` : "No losers",
      icon: TrendingDown,
      color: "text-red-500",
    },
    {
      title: "Total Market Cap",
      value: isLoading ? "..." : formatMarketCap(totalMarketCap),
      description: "Combined market value",
      icon: Building2,
      color: "text-blue-500",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className={`text-xs ${card.color === "text-green-500" ? "text-green-500" : card.color === "text-red-500" ? "text-red-500" : "text-muted-foreground"}`}>
              {card.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
