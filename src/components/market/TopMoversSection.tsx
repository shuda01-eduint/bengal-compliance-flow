import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, BarChart3, DollarSign, Activity } from "lucide-react";
import { StockDaily } from "@/hooks/useMarketData";

interface TopMoversSectionProps {
  stocks: StockDaily[];
  isLoading: boolean;
  onStockClick?: (code: string) => void;
}

type TabKey = "gainer" | "loser" | "volume" | "value" | "trade";

interface MoverRowProps {
  rank: number;
  symbol: string;
  ltp: number | null;
  change: number | null;
  onClick?: () => void;
}

function MoverRow({ rank, symbol, ltp, change, onClick }: MoverRowProps) {
  const changePercent = change || 0;
  const isPositive = changePercent > 0;
  const isNegative = changePercent < 0;

  return (
    <tr
      className="border-b border-border/30 hover:bg-white/5 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="py-3 px-4 text-muted-foreground text-sm">{rank}</td>
      <td className="py-3 px-4 font-medium text-white">{symbol}</td>
      <td className="py-3 px-4 text-right text-sm text-muted-foreground">
        {ltp?.toFixed(2) || "—"}
      </td>
      <td className="py-3 px-4 text-right">
        <span
          className={`text-sm font-medium ${
            isPositive ? "text-green-500" : isNegative ? "text-red-500" : "text-muted-foreground"
          }`}
        >
          {isPositive ? "+" : ""}
          {changePercent.toFixed(2)}%
        </span>
      </td>
    </tr>
  );
}

export function TopMoversSection({ stocks, isLoading, onStockClick }: TopMoversSectionProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("gainer");

  const movers = useMemo(() => {
    const sortedByGain = [...stocks]
      .filter(s => (s.change_pct || 0) > 0)
      .sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
      .slice(0, 10);

    const sortedByLoss = [...stocks]
      .filter(s => (s.change_pct || 0) < 0)
      .sort((a, b) => (a.change_pct || 0) - (b.change_pct || 0))
      .slice(0, 10);

    const sortedByVolume = [...stocks]
      .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
      .slice(0, 10);

    const sortedByValue = [...stocks]
      .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
      .slice(0, 10);

    const sortedByTrade = [...stocks]
      .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
      .slice(0, 10);

    return {
      gainer: sortedByGain,
      loser: sortedByLoss,
      volume: sortedByVolume,
      value: sortedByValue,
      trade: sortedByTrade,
    };
  }, [stocks]);

  const tabs = [
    { key: "gainer" as TabKey, label: "Top Gainer", icon: TrendingUp },
    { key: "loser" as TabKey, label: "Top Loser", icon: TrendingDown },
    { key: "volume" as TabKey, label: "Top Volume", icon: BarChart3 },
    { key: "value" as TabKey, label: "Top Value", icon: DollarSign },
    { key: "trade" as TabKey, label: "Top Trade", icon: Activity },
  ];

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Top Movers</h3>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <h3 className="text-lg font-semibold text-white mb-4">Top Movers</h3>
      
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList className="grid grid-cols-5 gap-1 bg-background/50 p-1 mb-4">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="flex items-center gap-1.5 text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <tab.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground">#</th>
                    <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground">SYMBOL</th>
                    <th className="py-2 px-4 text-right text-xs font-medium text-muted-foreground">LTP</th>
                    <th className="py-2 px-4 text-right text-xs font-medium text-muted-foreground">CHG %</th>
                  </tr>
                </thead>
                <tbody>
                  {movers[tab.key].length > 0 ? (
                    movers[tab.key].map((stock, index) => (
                      <MoverRow
                        key={stock.code}
                        rank={index + 1}
                        symbol={stock.code}
                        ltp={stock.close_price}
                        change={stock.change_pct}
                        onClick={() => onStockClick?.(stock.code)}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted-foreground">
                        No data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
