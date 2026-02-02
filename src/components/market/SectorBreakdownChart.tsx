import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts";
import { StockDaily } from "@/hooks/useMarketData";

interface SectorBreakdownChartProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-1, 220 70% 50%))",
  "hsl(var(--chart-2, 160 60% 45%))",
  "hsl(var(--chart-3, 30 80% 55%))",
  "hsl(var(--chart-4, 280 65% 60%))",
  "hsl(var(--chart-5, 340 75% 55%))",
  "hsl(200 70% 50%)",
  "hsl(120 60% 45%)",
  "hsl(45 80% 55%)",
  "hsl(300 65% 60%)",
];

export function SectorBreakdownChart({ stocks, isLoading }: SectorBreakdownChartProps) {
  const sectorData = stocks.reduce((acc, stock) => {
    const sector = stock.sector || "Unknown";
    if (!acc[sector]) {
      acc[sector] = { count: 0, marketCap: 0 };
    }
    acc[sector].count += 1;
    acc[sector].marketCap += stock.market_cap || 0;
    return acc;
  }, {} as Record<string, { count: number; marketCap: number }>);

  const chartData = Object.entries(sectorData)
    .map(([name, data]) => ({
      name: name.length > 15 ? name.substring(0, 15) + "..." : name,
      fullName: name,
      value: data.count,
      marketCap: data.marketCap,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const chartConfig = chartData.reduce((acc, item, index) => {
    acc[item.name] = {
      label: item.fullName,
      color: COLORS[index % COLORS.length],
    };
    return acc;
  }, {} as Record<string, { label: string; color: string }>);

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Sector Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <span className="text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg">Sector Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={COLORS[index % COLORS.length]}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <ChartTooltip 
                content={
                  <ChartTooltipContent 
                    formatter={(value, name, item) => (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{item.payload.fullName}</span>
                        <span>Stocks: {value}</span>
                      </div>
                    )}
                  />
                }
              />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle"
                wrapperStyle={{ fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
