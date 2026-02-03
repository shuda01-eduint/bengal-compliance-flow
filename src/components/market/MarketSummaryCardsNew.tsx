import { TrendingUp, TrendingDown, BarChart3, DollarSign, Activity } from "lucide-react";
import { StockDaily } from "@/hooks/useMarketData";

interface MarketSummaryCardsNewProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  gradient: string;
  iconBg: string;
}

function SummaryCard({ title, value, icon: Icon, gradient, iconBg }: SummaryCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-4 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      {/* Decorative circle */}
      <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/5" />
    </div>
  );
}

export function MarketSummaryCardsNew({ stocks, isLoading }: MarketSummaryCardsNewProps) {
  // Calculate market statistics from real data
  const totalStocks = stocks.length;
  const totalVolume = stocks.reduce((sum, s) => sum + (s.volume || 0), 0);
  const totalValue = stocks.reduce((sum, s) => sum + ((s.close_price || 0) * (s.volume || 0)), 0);
  const totalMarketCap = stocks.reduce((sum, s) => sum + (s.market_cap || 0), 0);
  
  const advancers = stocks.filter(s => (s.change || 0) > 0).length;
  const decliners = stocks.filter(s => (s.change || 0) < 0).length;

  const formatNumber = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toLocaleString();
  };

  const cards = [
    {
      title: "Total Stocks",
      value: isLoading ? "..." : totalStocks.toString(),
      icon: Activity,
      gradient: "bg-gradient-to-br from-amber-500 to-orange-600",
      iconBg: "bg-white/20",
    },
    {
      title: "Total Volume",
      value: isLoading ? "..." : formatNumber(totalVolume),
      icon: BarChart3,
      gradient: "bg-gradient-to-br from-emerald-500 to-green-600",
      iconBg: "bg-white/20",
    },
    {
      title: "Total Value",
      value: isLoading ? "..." : `৳${formatNumber(totalValue)}`,
      icon: DollarSign,
      gradient: "bg-gradient-to-br from-cyan-500 to-blue-600",
      iconBg: "bg-white/20",
    },
    {
      title: "Advancers",
      value: isLoading ? "..." : advancers.toString(),
      icon: TrendingUp,
      gradient: "bg-gradient-to-br from-green-500 to-emerald-600",
      iconBg: "bg-white/20",
    },
    {
      title: "Decliners",
      value: isLoading ? "..." : decliners.toString(),
      icon: TrendingDown,
      gradient: "bg-gradient-to-br from-rose-500 to-red-600",
      iconBg: "bg-white/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((card) => (
        <SummaryCard key={card.title} {...card} />
      ))}
    </div>
  );
}
