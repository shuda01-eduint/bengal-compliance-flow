import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { MarketSummaryCards } from "@/components/market/MarketSummaryCards";
import { SectorBreakdownChart } from "@/components/market/SectorBreakdownChart";
import { StockDataTable } from "@/components/market/StockDataTable";
import { StockDetailDialog } from "@/components/market/StockDetailDialog";
import { useStockDaily, useSectors, useLatestTradeDate } from "@/hooks/useMarketData";

export default function MarketPage() {
  const { data: latestDate, isLoading: latestDateLoading } = useLatestTradeDate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState("all");
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  // Set date to latest available when loaded
  useEffect(() => {
    if (latestDate && selectedDate === null) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate]);

  // Use the effective date - either selected or latest
  const effectiveDate = selectedDate || latestDate;

  const { data: stocks = [], isLoading: stocksLoading } = useStockDaily({
    trade_date: effectiveDate || undefined,
    sector_filter: selectedSector !== "all" ? selectedSector : undefined,
  });

  const { data: sectors = [] } = useSectors();

  // Show loading while fetching the latest date
  const isLoading = stocksLoading || latestDateLoading || !effectiveDate;

  return (
    <MainLayout title="Market" subtitle="Stock market overview and analytics">
      <div className="space-y-6">
        {/* Summary Cards */}
        <MarketSummaryCards stocks={stocks} isLoading={isLoading} />

        {/* Charts Section */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SectorBreakdownChart stocks={stocks} isLoading={isLoading} />
          
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
          isLoading={isLoading}
          onStockClick={setSelectedStock}
          selectedDate={effectiveDate || ""}
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
