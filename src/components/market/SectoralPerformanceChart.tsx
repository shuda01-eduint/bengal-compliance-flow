import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { StockDaily } from "@/hooks/useMarketData";

interface SectoralPerformanceChartProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

const SECTOR_COLORS = [
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ef4444", // red
  "#a855f7", // purple
  "#6366f1", // indigo
  "#10b981", // emerald
];

export function SectoralPerformanceChart({ stocks, isLoading }: SectoralPerformanceChartProps) {
  const sectorData = useMemo(() => {
    const sectorMap = new Map<string, {
      stocks: StockDaily[];
      totalValue: number;
      totalChange: number;
    }>();

    stocks.forEach(stock => {
      const sector = stock.sector || "Others";
      const value = (stock.close_price || 0) * ((stock.market_cap || 0) / (stock.close_price || 1)) * 0.001;
      
      if (!sectorMap.has(sector)) {
        sectorMap.set(sector, { stocks: [], totalValue: 0, totalChange: 0 });
      }
      
      const sectorInfo = sectorMap.get(sector)!;
      sectorInfo.stocks.push(stock);
      sectorInfo.totalValue += value;
      sectorInfo.totalChange += stock.change_pct || 0;
    });

    const totalMarketValue = Array.from(sectorMap.values()).reduce((sum, s) => sum + s.totalValue, 0);

    return Array.from(sectorMap.entries())
      .map(([sector, data], index) => ({
        sector,
        stockCount: data.stocks.length,
        value: data.totalValue,
        percentage: totalMarketValue > 0 ? (data.totalValue / totalMarketValue) * 100 : 0,
        avgChange: data.stocks.length > 0 ? data.totalChange / data.stocks.length : 0,
        color: SECTOR_COLORS[index % SECTOR_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [stocks]);

  const formatValue = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(2)}B`;
    return `${value.toFixed(2)}M`;
  };

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Sectoral Performance</h3>
        <div className="flex items-center justify-center h-80">
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
          <p className="font-bold text-white">{data.sector}</p>
          <p className="text-sm text-muted-foreground">{data.stockCount} stocks</p>
          <p className="text-sm text-white mt-1">Value: {formatValue(data.value)}</p>
          <p className="text-sm text-white">{data.percentage.toFixed(1)}% of market</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <h3 className="text-lg font-semibold text-white mb-6">Sectoral Performance</h3>
      
      <div className="flex items-start gap-6">
        {/* Donut Chart */}
        <div className="w-64 h-64 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={sectorData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {sectorData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 max-h-64 overflow-y-auto pr-2">
          <div className="space-y-2">
            {sectorData.map((sector, index) => (
              <div
                key={sector.sector}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: sector.color }}
                  />
                  <div>
                    <p className="text-sm font-medium text-white truncate max-w-[150px]">
                      {sector.sector}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {sector.stockCount} stocks
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">
                    {formatValue(sector.value)}
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-xs text-muted-foreground">
                      {sector.percentage.toFixed(1)}%
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        sector.avgChange >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {sector.avgChange >= 0 ? "+" : ""}
                      {sector.avgChange.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
