import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

interface PortfolioDetailDialogProps {
  portfolioId: string;
  onClose: () => void;
}

export function PortfolioDetailDialog({ portfolioId, onClose }: PortfolioDetailDialogProps) {
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

  const formatCurrency = (value: number | null) => {
    if (value === null) return "-";
    return new Intl.NumberFormat("en-BD", { style: "decimal", minimumFractionDigits: 2 }).format(value);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl">{portfolio?.name || "Portfolio Details"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
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

          {/* Holdings Table */}
          {holdings.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium text-foreground mb-3">Holdings ({holdings.length})</h4>
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-foreground">Trading Code</TableHead>
                        <TableHead className="text-foreground text-right">Quantity</TableHead>
                        <TableHead className="text-foreground text-right">Saleable</TableHead>
                        <TableHead className="text-foreground text-right">Avg Cost</TableHead>
                        <TableHead className="text-foreground text-right">Total Cost</TableHead>
                        <TableHead className="text-foreground text-right">Market Value</TableHead>
                        <TableHead className="text-foreground text-right">Gain/Loss</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdings.map((holding) => {
                        const gainLoss = (holding.market_value || 0) - (holding.total_cost || 0);
                        const isProfit = gainLoss >= 0;
                        return (
                          <TableRow key={holding.id} className="hover:bg-muted/30">
                            <TableCell className="font-medium text-foreground">{holding.trading_code}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{holding.total_stock?.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{holding.saleable?.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{formatCurrency(holding.avg_cost)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{formatCurrency(holding.total_cost)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{formatCurrency(holding.market_value)}</TableCell>
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
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">Total Quantity</p>
                    <p className="font-semibold text-foreground">
                      {holdings.reduce((sum, h) => sum + (h.total_stock || 0), 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">Total Cost</p>
                    <p className="font-semibold text-foreground">
                      {formatCurrency(holdings.reduce((sum, h) => sum + (h.total_cost || 0), 0))}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">Market Value</p>
                    <p className="font-semibold text-foreground">
                      {formatCurrency(holdings.reduce((sum, h) => sum + (h.market_value || 0), 0))}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">Total Gain/Loss</p>
                    {(() => {
                      const totalGainLoss = holdings.reduce((sum, h) => sum + ((h.market_value || 0) - (h.total_cost || 0)), 0);
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
