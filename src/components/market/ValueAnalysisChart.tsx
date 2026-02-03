import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { StockDaily } from "@/hooks/useMarketData";

interface ValueAnalysisChartProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

export function ValueAnalysisChart({ stocks, isLoading }: ValueAnalysisChartProps) {
  const [activeTab, setActiveTab] = useState<"highest" | "lowest">("highest");

  const chartData = useMemo(() => {
    // Calculate value as close_price * estimated volume (using market_cap as proxy)
    const stocksWithValue = stocks.map(s => ({
      ...s,
      value: (s.close_price || 0) * ((s.market_cap || 0) / (s.close_price || 1)) * 0.001, // Simulated daily value
    }));

    const sorted = [...stocksWithValue].sort((a, b) => 
      activeTab === "highest" ? b.value - a.value : a.value - b.value
    );

    return sorted.slice(0, 20).map(s => ({
      code: s.code,
      name: s.name || s.code,
      value: s.value,
      ltp: s.close_price || 0,
      change: s.change_pct || 0,
      isPositive: (s.change_pct || 0) >= 0,
    }));
  }, [stocks, activeTab]);

  const maxValue = useMemo(() => {
    return Math.max(...chartData.map(d => d.value), 1);
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Value Analysis</h3>
        <div className="flex items-center justify-center h-[500px]">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#1e1e2f] border border-border/50 rounded-lg p-3 shadow-xl">
          <p className="font-bold text-white">{data.code}</p>
          <p className="text-sm text-muted-foreground">{data.name}</p>
          <p className="text-sm text-white mt-2">
            Value: <span className="font-medium">{data.value.toFixed(2)}M Tk</span>
          </p>
          <p className="text-sm text-white">
            LTP: <span className="font-medium">{data.ltp.toFixed(2)}</span>
          </p>
          <p className={`text-sm font-medium ${data.isPositive ? "text-green-500" : "text-red-500"}`}>
            Change: {data.isPositive ? "+" : ""}{data.change.toFixed(2)}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Value Analysis</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("highest")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "highest"
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            Highest
          </button>
          <button
            onClick={() => setActiveTab("lowest")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "lowest"
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <TrendingDown className="h-4 w-4" />
            Lowest
          </button>
        </div>
      </div>

      <div className="h-[500px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
          >
            <XAxis
              type="number"
              domain={[0, maxValue * 1.1]}
              tickFormatter={(value) => `${value.toFixed(1)}M`}
              stroke="#6b7280"
              fontSize={12}
            />
            <YAxis
              type="category"
              dataKey="code"
              stroke="#6b7280"
              fontSize={12}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isPositive ? "#22c55e" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
