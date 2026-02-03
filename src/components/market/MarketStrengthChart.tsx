import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { StockDaily } from "@/hooks/useMarketData";

interface MarketStrengthChartProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

export function MarketStrengthChart({ stocks, isLoading }: MarketStrengthChartProps) {
  const { advancers, decliners, unchanged, total, chartData } = useMemo(() => {
    const adv = stocks.filter(s => (s.change || 0) > 0).length;
    const dec = stocks.filter(s => (s.change || 0) < 0).length;
    const unch = stocks.filter(s => (s.change || 0) === 0).length;
    
    return {
      advancers: adv,
      decliners: dec,
      unchanged: unch,
      total: stocks.length,
      chartData: [
        { name: "Advancers", value: adv, color: "#22c55e" },
        { name: "Decliners", value: dec, color: "#ef4444" },
        { name: "Unchanged", value: unch, color: "#6b7280" },
      ].filter(d => d.value > 0),
    };
  }, [stocks]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Market Strength</h3>
        <div className="flex items-center justify-center h-48">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <h3 className="text-lg font-semibold text-white mb-4">Market Strength</h3>
      
      <div className="flex items-center gap-8">
        <div className="relative w-48 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-white">{total}</span>
            <span className="text-xs text-muted-foreground">Total Stocks</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-sm text-muted-foreground">Advancers</span>
            <span className="text-sm font-semibold text-green-500 ml-auto">{advancers}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm text-muted-foreground">Decliners</span>
            <span className="text-sm font-semibold text-red-500 ml-auto">{decliners}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-gray-500" />
            <span className="text-sm text-muted-foreground">Unchanged</span>
            <span className="text-sm font-semibold text-gray-400 ml-auto">{unchanged}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
