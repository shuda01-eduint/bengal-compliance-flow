import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { MarketSummaryCards } from "@/components/market/MarketSummaryCards";
import { SectorBreakdownChart } from "@/components/market/SectorBreakdownChart";
import { StockDataTable } from "@/components/market/StockDataTable";
import { StockDetailDialog } from "@/components/market/StockDetailDialog";
import { useStockDaily, useSectors } from "@/hooks/useMarketData";
import { format } from "date-fns";

export default function MarketPage() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedSector, setSelectedSector] = useState("all");
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  const { data: stocks = [], isLoading: stocksLoading } = useStockDaily({
    trade_date: selectedDate || undefined,
    sector_filter: selectedSector !== "all" ? selectedSector : undefined,
  });

  const { data: sectors = [] } = useSectors();

  return (
    <MainLayout title="Market" subtitle="Stock market overview and analytics">
      <div className="space-y-6">
        {/* Summary Cards */}
        <MarketSummaryCards stocks={stocks} isLoading={stocksLoading} />

        {/* Charts Section */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SectorBreakdownChart stocks={stocks} isLoading={stocksLoading} />
          
          {/* Quick Stats Card */}
          <div className="grid gap-4 md:grid-cols-2">
            <QuickStatCard
              title="Gainers"
              count={stocks.filter((s) => (s.change || 0) > 0).length}
              total={stocks.length}
              color="text-green-500"
            />
            <QuickStatCard
              title="Losers"
              count={stocks.filter((s) => (s.change || 0) < 0).length}
              total={stocks.length}
              color="text-red-500"
            />
            <QuickStatCard
              title="Unchanged"
              count={stocks.filter((s) => (s.change || 0) === 0).length}
              total={stocks.length}
              color="text-muted-foreground"
            />
            <QuickStatCard
              title="Marginable"
              count={stocks.filter((s) => s.is_marginable).length}
              total={stocks.length}
              color="text-blue-500"
            />
          </div>
        </div>

        {/* Stock Data Table */}
        <StockDataTable
          stocks={stocks}
          sectors={sectors}
          isLoading={stocksLoading}
          onStockClick={setSelectedStock}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          selectedSector={selectedSector}
          onSectorChange={setSelectedSector}
        />

        {/* Stock Detail Dialog */}
        <StockDetailDialog code={selectedStock} onClose={() => setSelectedStock(null)} />
      </div>
    </MainLayout>
  );
}

function QuickStatCard({
  title,
  count,
  total,
  color,
}: {
  title: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : "0";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-muted-foreground">{percentage}% of total</div>
    </div>
  );
}
