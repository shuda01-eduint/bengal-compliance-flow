import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/balance-utils";
import { format } from "date-fns";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradeDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investorCode: string;
  investorName: string;
  tradeType: 'BUY' | 'SELL';
  fromDate: Date;
  toDate: Date;
}

interface TradeDetail {
  security_code: string;
  quantity: number;
  price: number;
  value: number;
  brokerage_commission: number;
  trade_date: string;
  trade_time: string;
  order_id: string;
}

export function TradeDetailsDialog({
  open,
  onOpenChange,
  investorCode,
  investorName,
  tradeType,
  fromDate,
  toDate,
}: TradeDetailsDialogProps) {
  const fromDateStr = format(fromDate, 'yyyyMMdd');
  const toDateStr = format(toDate, 'yyyyMMdd');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trade-details', investorCode, tradeType, fromDateStr, toDateStr],
    queryFn: async () => {
      const sideFilter = tradeType === 'BUY' ? ['B', 'BUY'] : ['S', 'SELL'];
      
      const { data, error } = await supabase
        .from('trade_history')
        .select('security_code, quantity, price, value, brokerage_commission, trade_date, trade_time, order_id, status, fill_type')
        .eq('client_code', investorCode)
        .gte('trade_date', fromDateStr)
        .lte('trade_date', toDateStr)
        .in('side', sideFilter)
        .gt('value', 0)
        .order('trade_date', { ascending: false })
        .order('security_code', { ascending: true });

      if (error) throw error;
      
      // Filter to only include actual fills (PF or FILL status)
      const filteredData = (data || []).filter(t => {
        const status = (t.status || '').toUpperCase();
        const fillType = (t.fill_type || '').toUpperCase();
        return status === 'PF' || status === 'FILL' || fillType === 'PF' || fillType === 'FILL';
      });
      
      return filteredData as TradeDetail[];
    },
    enabled: open && !!investorCode,
  });

  // Aggregate trades by security
  const aggregatedTrades = trades.reduce((acc, trade) => {
    const key = `${trade.trade_date}_${trade.security_code}`;
    if (!acc[key]) {
      acc[key] = {
        security_code: trade.security_code,
        trade_date: trade.trade_date,
        quantity: 0,
        value: 0,
        avg_price: 0,
        trade_count: 0,
        brokerage_rate: trade.brokerage_commission || 0,
      };
    }
    acc[key].quantity += trade.quantity || 0;
    acc[key].value += trade.value || 0;
    acc[key].trade_count += 1;
    return acc;
  }, {} as Record<string, { security_code: string; trade_date: string; quantity: number; value: number; avg_price: number; trade_count: number; brokerage_rate: number }>);

  const aggregatedList = Object.values(aggregatedTrades).map(t => ({
    ...t,
    avg_price: t.quantity > 0 ? t.value / t.quantity : 0,
    // brokerage_rate is already a decimal multiplier (e.g., 0.004 for 0.4%)
    brokerage_amount: t.value * t.brokerage_rate,
  })).sort((a, b) => b.value - a.value);

  const totalValue = aggregatedList.reduce((sum, t) => sum + t.value, 0);
  const totalQuantity = aggregatedList.reduce((sum, t) => sum + t.quantity, 0);
  const totalBrokerage = aggregatedList.reduce((sum, t) => sum + t.brokerage_amount, 0);
  const netAmount = tradeType === 'BUY' 
    ? totalValue + totalBrokerage  // Buy: pay value + commission
    : totalValue - totalBrokerage; // Sell: receive value - commission

  const Icon = tradeType === 'BUY' ? TrendingDown : TrendingUp;
  const colorClass = tradeType === 'BUY' ? 'text-red-400' : 'text-green-400';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Icon className={`h-5 w-5 ${colorClass}`} />
            <span>{tradeType} Trades</span>
            <Badge variant="outline" className="font-mono">{investorCode}</Badge>
            <span className="text-muted-foreground font-normal text-sm">
              {investorName}
            </span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {format(fromDate, 'dd MMM yyyy')} - {format(toDate, 'dd MMM yyyy')}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : aggregatedList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No {tradeType.toLowerCase()} trades found for this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Date</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Brokerage</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregatedList.map((trade, idx) => {
                  const net = tradeType === 'BUY'
                    ? trade.value + trade.brokerage_amount
                    : trade.value - trade.brokerage_amount;
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">
                        {trade.trade_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}
                      </TableCell>
                      <TableCell className="font-medium">{trade.security_code}</TableCell>
                      <TableCell className="text-right">{trade.quantity.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{trade.avg_price.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(trade.value)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(trade.brokerage_amount)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${colorClass}`}>
                        {formatCurrency(net)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="bg-muted/30 font-semibold border-t-2">
                  <TableCell colSpan={2}>Total ({aggregatedList.length} securities)</TableCell>
                  <TableCell className="text-right">{totalQuantity.toLocaleString()}</TableCell>
                  <TableCell className="text-right">-</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalValue)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(totalBrokerage)}
                  </TableCell>
                  <TableCell className={`text-right ${colorClass}`}>
                    {formatCurrency(netAmount)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>

        {/* Summary Footer */}
        {!isLoading && aggregatedList.length > 0 && (
          <div className="border-t pt-4 mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Gross Amount:</span>
              <span className="ml-2 font-semibold">{formatCurrency(totalValue)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Brokerage:</span>
              <span className="ml-2 font-semibold">{formatCurrency(totalBrokerage)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Net {tradeType === 'BUY' ? 'Payable' : 'Receivable'}:</span>
              <span className={`ml-2 font-semibold ${colorClass}`}>{formatCurrency(netAmount)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
