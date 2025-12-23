import { format, addDays, parseISO, differenceInDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, CheckCircle2, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

interface PendingTrade {
  security_code: string;
  side: string;
  quantity: number;
  trade_date: string;
  settlement_days: number;
  settlement_date: Date;
  days_remaining: number;
}

interface SettlementTimelineProps {
  trades: PendingTrade[];
}

export function SettlementTimeline({ trades }: SettlementTimelineProps) {
  if (trades.length === 0) {
    return (
      <Card className="bg-muted/30 border-border">
        <CardContent className="py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No pending settlements</p>
        </CardContent>
      </Card>
    );
  }

  // Group trades by settlement date
  const groupedByDate = trades.reduce((acc, trade) => {
    const dateKey = format(trade.settlement_date, "yyyy-MM-dd");
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(trade);
    return acc;
  }, {} as Record<string, PendingTrade[]>);

  const sortedDates = Object.keys(groupedByDate).sort();
  const today = new Date();

  return (
    <Card className="bg-muted/30 border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Settlement Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timeline visualization */}
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
          
          {/* Today marker */}
          <div className="relative flex items-center gap-3 mb-4">
            <div className="relative z-10 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-[10px] text-primary-foreground font-bold">T</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Today</p>
              <p className="text-xs text-muted-foreground">{format(today, "EEE, MMM d, yyyy")}</p>
            </div>
          </div>

          {/* Settlement dates */}
          {sortedDates.map((dateKey, index) => {
            const tradesOnDate = groupedByDate[dateKey];
            const settlementDate = parseISO(dateKey);
            const daysUntil = differenceInDays(settlementDate, today);
            const isToday = daysUntil === 0;
            const isPast = daysUntil < 0;
            
            // Determine T+ label based on first trade's settlement days
            const settlementDays = tradesOnDate[0].settlement_days;
            
            return (
              <div key={dateKey} className="relative flex items-start gap-3 pb-4">
                {/* Timeline node */}
                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                  isPast 
                    ? 'bg-green-500 border-green-500' 
                    : isToday 
                      ? 'bg-yellow-500 border-yellow-500' 
                      : 'bg-background border-muted-foreground/30'
                }`}>
                  {isPast ? (
                    <CheckCircle2 className="h-4 w-4 text-white" />
                  ) : (
                    <span className={`text-[10px] font-bold ${isToday ? 'text-white' : 'text-muted-foreground'}`}>
                      {daysUntil}d
                    </span>
                  )}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-medium text-foreground">
                      {format(settlementDate, "EEE, MMM d")}
                    </p>
                    <Badge 
                      variant="outline" 
                      className={`text-[10px] px-1.5 py-0 ${
                        settlementDays === 3 
                          ? 'border-orange-500 text-orange-500' 
                          : 'border-blue-500 text-blue-500'
                      }`}
                    >
                      T+{settlementDays}
                    </Badge>
                    {isPast && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-600">
                        Settled
                      </Badge>
                    )}
                    {isToday && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-500/20 text-yellow-600">
                        Settling Today
                      </Badge>
                    )}
                  </div>
                  
                  {/* Trades list */}
                  <div className="space-y-1.5">
                    {tradesOnDate.map((trade, tradeIndex) => (
                      <div 
                        key={`${trade.security_code}-${trade.side}-${tradeIndex}`}
                        className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 ${
                          trade.side === "BUY" 
                            ? 'bg-green-500/10' 
                            : 'bg-red-500/10'
                        }`}
                      >
                        {trade.side === "BUY" ? (
                          <TrendingUp className="h-3 w-3 text-green-600" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-600" />
                        )}
                        <span className={`font-medium ${
                          trade.side === "BUY" ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {trade.side}
                        </span>
                        <span className="text-foreground font-medium">{trade.security_code}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {trade.quantity.toLocaleString()} units
                        </span>
                        {trade.settlement_days === 3 && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/50 text-orange-500">
                            Z
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="border-t border-border pt-3 grid grid-cols-2 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">
              +{trades.filter(t => t.side === "BUY").reduce((sum, t) => sum + t.quantity, 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">Pending Buys</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-600">
              -{trades.filter(t => t.side === "SELL").reduce((sum, t) => sum + t.quantity, 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">Pending Sells</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground border-t border-border pt-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>T+2 (Regular)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span>T+3 (Z Category)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
