import { useMemo } from "react";
import { StockDaily } from "@/hooks/useMarketData";

interface MarketSentimentProps {
  stocks: StockDaily[];
  isLoading: boolean;
}

export function MarketSentiment({ stocks, isLoading }: MarketSentimentProps) {
  const { sentiment, advancerRatio, sliderPosition } = useMemo(() => {
    const advancers = stocks.filter(s => (s.change || 0) > 0).length;
    const total = stocks.length || 1;
    const ratio = (advancers / total) * 100;
    
    let sent: "Bull" | "Bear" | "Neutral";
    if (ratio >= 55) sent = "Bull";
    else if (ratio <= 45) sent = "Bear";
    else sent = "Neutral";

    return {
      sentiment: sent,
      advancerRatio: ratio,
      sliderPosition: ratio,
    };
  }, [stocks]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">Market Sentiment</h3>
        <div className="flex items-center justify-center h-48">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <h3 className="text-lg font-semibold text-white mb-4">Market Sentiment</h3>
      
      <div className="flex flex-col items-center gap-6">
        {/* Sentiment Text */}
        <div className="text-center">
          <span
            className={`text-5xl font-bold ${
              sentiment === "Bull"
                ? "text-green-500"
                : sentiment === "Bear"
                ? "text-red-500"
                : "text-gray-400"
            }`}
          >
            {sentiment}
          </span>
        </div>

        {/* Gradient Slider */}
        <div className="w-full max-w-xs">
          <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-gray-500 to-green-500">
            {/* Slider thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 border-gray-800 shadow-lg transition-all duration-300"
              style={{ left: `calc(${sliderPosition}% - 10px)` }}
            />
          </div>
          
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Bear</span>
            <span>Neutral</span>
            <span>Bull</span>
          </div>
        </div>

        {/* Advancer Ratio */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">Advancer Ratio</p>
          <span
            className={`text-3xl font-bold ${
              advancerRatio >= 55
                ? "text-green-500"
                : advancerRatio <= 45
                ? "text-red-500"
                : "text-gray-400"
            }`}
          >
            {advancerRatio.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
