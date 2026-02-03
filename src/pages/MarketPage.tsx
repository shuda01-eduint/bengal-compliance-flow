import { useState, useEffect, useCallback } from "react";
import { MarketHeader } from "@/components/market/MarketHeader";
import { MarketNavBar } from "@/components/market/MarketNavBar";
import { MarketDisclaimer } from "@/components/market/MarketDisclaimer";
import { MarketSummaryCardsNew } from "@/components/market/MarketSummaryCardsNew";
import { MarketStrengthChart } from "@/components/market/MarketStrengthChart";
import { MarketSentiment } from "@/components/market/MarketSentiment";
import { TopMoversSection } from "@/components/market/TopMoversSection";
import { StockDetailDialog } from "@/components/market/StockDetailDialog";
import { useStockDaily, useLatestTradeDate } from "@/hooks/useMarketData";
import { useQueryClient } from "@tanstack/react-query";

export default function MarketPage() {
  const queryClient = useQueryClient();
  const { data: latestDate, isLoading: latestDateLoading } = useLatestTradeDate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

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
  });

  // Filter stocks based on search query
  const filteredStocks = stocks.filter(
    (s) =>
      s.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.name && s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Show loading while fetching the latest date
  const isLoading = stocksLoading || latestDateLoading || !effectiveDate;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["stock-daily"] });
    await queryClient.invalidateQueries({ queryKey: ["latest-trade-date"] });
    setIsRefreshing(false);
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <MarketHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />

        {/* Navigation Bar */}
        <MarketNavBar onSearch={setSearchQuery} />

        {/* Disclaimer */}
        <MarketDisclaimer />

        {/* Summary Cards */}
        <MarketSummaryCardsNew stocks={filteredStocks} isLoading={isLoading} />

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <MarketStrengthChart stocks={filteredStocks} isLoading={isLoading} />
          <MarketSentiment stocks={filteredStocks} isLoading={isLoading} />
        </div>

        {/* Top Movers Section */}
        <TopMoversSection
          stocks={filteredStocks}
          isLoading={isLoading}
          onStockClick={setSelectedStock}
        />

        {/* Stock Detail Dialog */}
        <StockDetailDialog code={selectedStock} onClose={() => setSelectedStock(null)} />
      </div>
    </div>
  );
}
