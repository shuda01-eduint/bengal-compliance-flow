import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmationNote } from "./ConfirmationNote";
import { SettlementTimeline } from "./SettlementTimeline";
import { format, subDays, addDays, parseISO } from "date-fns";

interface PortfolioDetailDialogProps {
  portfolioId: string;
  onClose: () => void;
}

interface HoldingWithAdjustment {
  id: string;
  trading_code: string;
  total_stock: number;
  saleable: number;
  avg_cost: number | null;
  total_cost: number | null;
  market_value: number | null;
  // Adjusted values
  adjusted_qty: number;
  matured_qty: number;
  pending_buy: number;
  pending_sell: number;
}

export function PortfolioDetailDialog({ portfolioId, onClose }: PortfolioDetailDialogProps) {
  const today = new Date();

  // Fetch portfolio details
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolios")
        .select("*")
        .eq("id", portfolioId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  // Fetch client balance data
  const { data: clientData } = useQuery({
    queryKey: ["portfolio-client", portfolio?.investor_code],
    queryFn: async () => {
      if (!portfolio?.investor_code) return null;
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("inv_code", portfolio.investor_code)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!portfolio?.investor_code
  });

  // Fetch investor data for confirmation note
  const { data: investorData } = useQuery({
    queryKey: ["portfolio-investor", portfolio?.investor_code],
    queryFn: async () => {
      if (!portfolio?.investor_code) return null;
      const { data, error } = await supabase
        .from("investors")
        .select("bo_id, cell_no, home_address")
        .eq("investor_code", portfolio.investor_code)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!portfolio?.investor_code
  });

  // Fetch holdings data
  const { data: holdings = [] } = useQuery({
    queryKey: ["portfolio-holdings", portfolio?.investor_code],
    queryFn: async () => {
      if (!portfolio?.investor_code) return [];
      const { data, error } = await supabase
        .from("holdings")
        .select("*")
        .eq("investor_code", portfolio.investor_code);
      if (error) throw error;
      return data;
    },
    enabled: !!portfolio?.investor_code
  });

  // Fetch securities for category (settlement rules)
  const { data: securities = [] } = useQuery({
    queryKey: ["securities-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("securities")
        .select("trading_code, category");
      if (error) throw error;
      return data;
    }
  });

  // Fetch recent trades for settlement adjustment (last 3 days for Z, last 2 days for others)
  const { data: recentTrades = [] } = useQuery({
    queryKey: ["portfolio-recent-trades", portfolio?.investor_code],
    queryFn: async () => {
      if (!portfolio?.investor_code) return [];
      // Fetch trades from last 3 days to cover both T+2 and T+3
      const threeDaysAgo = format(subDays(today, 3), "yyyyMMdd");
      const { data, error } = await supabase
        .from("trade_history")
        .select("security_code, side, quantity, trade_date")
        .eq("client_code", portfolio.investor_code)
        .gte("trade_date", threeDaysAgo);
      if (error) throw error;
      return data;
    },
    enabled: !!portfolio?.investor_code
  });

  // Fetch custom field values
  const { data: fieldValues = [] } = useQuery({
    queryKey: ["portfolio-field-values", portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_field_values")
        .select(`
          id,
          value,
          field_id,
          portfolio_custom_fields (
            field_name
          )
        `)
        .eq("portfolio_id", portfolioId);
      if (error) throw error;
      return data;
    }
  });

  // Create category map for securities
  const categoryMap = new Map(securities.map(s => [s.trading_code, s.category]));

  // Calculate settlement-adjusted holdings
  const adjustedHoldings: HoldingWithAdjustment[] = holdings.map(holding => {
    const category = categoryMap.get(holding.trading_code);
    const settlementDays = category === "Z" ? 3 : 2; // T+3 for Z category, T+2 for others
    const settlementDate = format(subDays(today, settlementDays), "yyyyMMdd");
    const todayStr = format(today, "yyyyMMdd");

    // Find pending trades (not yet settled)
    const pendingTrades = recentTrades.filter(
      t => t.security_code === holding.trading_code && t.trade_date > settlementDate
    );

    const pendingBuy = pendingTrades
      .filter(t => t.side === "BUY")
      .reduce((sum, t) => sum + (t.quantity || 0), 0);

    const pendingSell = pendingTrades
      .filter(t => t.side === "SELL")
      .reduce((sum, t) => sum + (t.quantity || 0), 0);

    // Current qty includes all trades; adjusted qty removes pending
    const adjustedQty = (holding.total_stock || 0) - pendingBuy + pendingSell;
    const maturedQty = adjustedQty; // Matured = after settlement adjustment

    return {
      id: holding.id,
      trading_code: holding.trading_code,
      total_stock: holding.total_stock || 0,
      saleable: holding.saleable || 0,
      avg_cost: holding.avg_cost,
      total_cost: holding.total_cost,
      market_value: holding.market_value,
      adjusted_qty: adjustedQty,
      matured_qty: maturedQty,
      pending_buy: pendingBuy,
      pending_sell: pendingSell,
    };
  });

  const formatCurrency = (value: number | null) => {
    if (value === null) return "-";
    return new Intl.NumberFormat("en-BD", { style: "decimal", minimumFractionDigits: 2 }).format(value);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl">{portfolio?.name || "Portfolio Details"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="holdings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="confirmation">Confirmation Note</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="space-y-6">
            {/* Portfolio Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Investor Code</p>
                <p className="font-medium text-foreground">{portfolio?.investor_code}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-medium text-foreground">
                  {portfolio?.created_at ? new Date(portfolio.created_at).toLocaleDateString() : "-"}
                </p>
              </div>
              {portfolio?.description && (
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="font-medium text-foreground">{portfolio.description}</p>
                </div>
              )}
            </div>

            {/* Custom Field Values */}
            {fieldValues.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-3">Custom Fields</h4>
                  <div className="flex flex-wrap gap-3">
                    {fieldValues.map((fv: any) => (
                      <div key={fv.id} className="bg-muted/50 rounded-lg px-3 py-2">
                        <p className="text-xs text-muted-foreground">{fv.portfolio_custom_fields?.field_name}</p>
                        <Badge variant="secondary">{fv.value}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Client Balance Info */}
            {clientData && (
              <>
                <Separator />
                <Card className="bg-muted/30 border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-foreground">Client Balance Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Investor Name</p>
                        <p className="font-medium text-foreground">{clientData.investor_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Ledger Balance</p>
                        <p className="font-medium text-foreground">{formatCurrency(clientData.ledger_balance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Market Value</p>
                        <p className="font-medium text-foreground">{formatCurrency(clientData.market_value)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Equity</p>
                        <p className="font-medium text-foreground">{formatCurrency(clientData.equity)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Settlement Timeline */}
            {recentTrades.length > 0 && (
              <>
                <Separator />
                {(() => {
                  // Build pending trades with settlement info for timeline
                  const pendingTradesForTimeline = recentTrades
                    .filter(trade => {
                      const category = categoryMap.get(trade.security_code || '');
                      const settlementDays = category === "Z" ? 3 : 2;
                      const settlementDate = format(subDays(today, settlementDays), "yyyyMMdd");
                      return trade.trade_date && trade.trade_date > settlementDate;
                    })
                    .map(trade => {
                      const category = categoryMap.get(trade.security_code || '');
                      const settlementDays = category === "Z" ? 3 : 2;
                      // Parse trade date (format: YYYYMMDD)
                      const tradeDateStr = trade.trade_date || '';
                      const tradeDate = tradeDateStr ? 
                        new Date(
                          parseInt(tradeDateStr.substring(0, 4)),
                          parseInt(tradeDateStr.substring(4, 6)) - 1,
                          parseInt(tradeDateStr.substring(6, 8))
                        ) : today;
                      const settlementDate = addDays(tradeDate, settlementDays);
                      const daysRemaining = Math.ceil((settlementDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      
                      return {
                        security_code: trade.security_code || '',
                        side: trade.side || '',
                        quantity: trade.quantity || 0,
                        trade_date: trade.trade_date || '',
                        settlement_days: settlementDays,
                        settlement_date: settlementDate,
                        days_remaining: daysRemaining
                      };
                    });
                  
                  return <SettlementTimeline trades={pendingTradesForTimeline} />;
                })()}
              </>
            )}

            {/* Holdings Table with Settlement Adjustments */}
            {adjustedHoldings.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-3">
                    Holdings ({adjustedHoldings.length}) - Settlement Adjusted
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    * Z category: T+3 settlement, Others: T+2 settlement
                  </p>
                  <div className="rounded-md border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-foreground">Trading Code</TableHead>
                          <TableHead className="text-foreground text-right">Total Qty</TableHead>
                          <TableHead className="text-foreground text-right">Matured Qty</TableHead>
                          <TableHead className="text-foreground text-right">Pending Buy</TableHead>
                          <TableHead className="text-foreground text-right">Pending Sell</TableHead>
                          <TableHead className="text-foreground text-right">Saleable</TableHead>
                          <TableHead className="text-foreground text-right">Avg Cost</TableHead>
                          <TableHead className="text-foreground text-right">Total Cost</TableHead>
                          <TableHead className="text-foreground text-right">Market Value</TableHead>
                          <TableHead className="text-foreground text-right">Gain/Loss</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustedHoldings.map((holding) => {
                          const gainLoss = (holding.market_value || 0) - (holding.total_cost || 0);
                          const isProfit = gainLoss >= 0;
                          const category = categoryMap.get(holding.trading_code);
                          return (
                            <TableRow key={holding.id} className="hover:bg-muted/30">
                              <TableCell className="font-medium text-foreground">
                                {holding.trading_code}
                                {category === "Z" && (
                                  <Badge variant="outline" className="ml-2 text-xs">Z</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {holding.total_stock.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right font-medium text-foreground">
                                {holding.matured_qty.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right text-green-600">
                                {holding.pending_buy > 0 ? `+${holding.pending_buy.toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell className="text-right text-red-600">
                                {holding.pending_sell > 0 ? `-${holding.pending_sell.toLocaleString()}` : "-"}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {holding.saleable.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatCurrency(holding.avg_cost)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatCurrency(holding.total_cost)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatCurrency(holding.market_value)}
                              </TableCell>
                              <TableCell className={`text-right font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                                {isProfit ? '+' : ''}{formatCurrency(gainLoss)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Holdings Summary */}
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">Total Quantity</p>
                      <p className="font-semibold text-foreground">
                        {adjustedHoldings.reduce((sum, h) => sum + h.total_stock, 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">Matured Quantity</p>
                      <p className="font-semibold text-foreground">
                        {adjustedHoldings.reduce((sum, h) => sum + h.matured_qty, 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">Total Cost</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(adjustedHoldings.reduce((sum, h) => sum + (h.total_cost || 0), 0))}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">Market Value</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(adjustedHoldings.reduce((sum, h) => sum + (h.market_value || 0), 0))}
                      </p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">Total Gain/Loss</p>
                      {(() => {
                        const totalGainLoss = adjustedHoldings.reduce((sum, h) => sum + ((h.market_value || 0) - (h.total_cost || 0)), 0);
                        const isProfit = totalGainLoss >= 0;
                        return (
                          <p className={`font-semibold ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                            {isProfit ? '+' : ''}{formatCurrency(totalGainLoss)}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="confirmation">
            {portfolio?.investor_code && clientData && (
              <ConfirmationNote
                investorCode={portfolio.investor_code}
                investorName={clientData.investor_name}
                boId={investorData?.bo_id || null}
                phone={investorData?.cell_no}
                address={investorData?.home_address}
                openingBalance={clientData.ledger_balance}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
