import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface MarketHeaderProps {
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function MarketHeader({ onRefresh, isRefreshing }: MarketHeaderProps) {
  const [countdown, setCountdown] = useState(10);
  const [isMarketOpen, setIsMarketOpen] = useState(false);

  // Check if market is open (DSE hours: Sunday-Thursday, 10:00 AM - 2:30 PM BST)
  useEffect(() => {
    const checkMarketStatus = () => {
      const now = new Date();
      const bdTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
      const day = bdTime.getDay();
      const hours = bdTime.getHours();
      const minutes = bdTime.getMinutes();
      const currentMinutes = hours * 60 + minutes;
      
      // Sunday = 0, Monday = 1, ..., Thursday = 4
      const isWeekday = day >= 0 && day <= 4;
      const isMarketHours = currentMinutes >= 600 && currentMinutes <= 870; // 10:00 AM to 2:30 PM
      
      setIsMarketOpen(isWeekday && isMarketHours);
    };

    checkMarketStatus();
    const interval = setInterval(checkMarketStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onRefresh();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onRefresh]);

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <span className="text-white font-bold text-lg">U</span>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">UCB STOCK</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Live Exchange Data</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 text-muted-foreground hover:text-white"
          onClick={() => {
            onRefresh();
            setCountdown(10);
          }}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">{countdown}s</span>
        </Button>

        <Badge 
          variant="outline" 
          className={`${
            isMarketOpen 
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' 
              : 'bg-red-500/20 text-red-400 border-red-500/50'
          }`}
        >
          {isMarketOpen ? 'Open' : 'Closed'}
        </Badge>
      </div>
    </div>
  );
}
