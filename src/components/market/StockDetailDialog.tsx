import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { useStockHistorical, useStockFundamentals, StockFundamentals } from "@/hooks/useMarketData";
import { format } from "date-fns";

interface StockDetailDialogProps {
  code: string | null;
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function StockDetailDialog({ code, onClose }: StockDetailDialogProps) {
  const [historyPage, setHistoryPage] = useState(1);
  
  const { data: historicalData, isLoading: historyLoading } = useStockHistorical({
    code_filter: code || "",
    page_number: historyPage,
    page_size: PAGE_SIZE,
  });

  const { data: fundamentalsData, isLoading: fundamentalsLoading } = useStockFundamentals({
    code_filter: code || undefined,
  });

  const fundamentals = fundamentalsData?.[0] as StockFundamentals | undefined;

  const chartData = (historicalData || [])
    .slice()
    .reverse()
    .map((d) => ({
      date: format(new Date(d.date), "MMM dd"),
      price: d.close_price || 0,
    }));

  const chartConfig = {
    price: {
      label: "Price",
      color: "hsl(var(--primary))",
    },
  };

  const formatNumber = (value: number | null | undefined, decimals = 2) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatMarketCap = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    if (value >= 1e12) return `৳${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `৳${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `৳${(value / 1e6).toFixed(2)}M`;
    return `৳${value.toLocaleString()}`;
  };

  const FundamentalItem = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <Dialog open={!!code} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-xl">{code}</span>
            {fundamentals?.name && (
              <span className="text-lg text-muted-foreground font-normal">
                {fundamentals.name}
              </span>
            )}
            {fundamentals?.sector && (
              <Badge variant="outline">{fundamentals.sector}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="chart" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chart">Price Chart</TabsTrigger>
            <TabsTrigger value="fundamentals">Fundamentals</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Price History</CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    Loading chart...
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No historical data available
                  </div>
                ) : (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={{ stroke: "hsl(var(--border))" }}
                          axisLine={{ stroke: "hsl(var(--border))" }}
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={{ stroke: "hsl(var(--border))" }}
                          axisLine={{ stroke: "hsl(var(--border))" }}
                          domain={["dataMin - 5", "dataMax + 5"]}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fundamentals" className="mt-4">
            {fundamentalsLoading ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Loading fundamentals...
              </div>
            ) : !fundamentals ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No fundamentals data available
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-lg">Valuation Metrics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <FundamentalItem label="Market Cap" value={formatMarketCap(fundamentals.market_cap)} />
                    <FundamentalItem label="Free Float M.Cap" value={formatMarketCap(fundamentals.free_float_mcap)} />
                    <FundamentalItem label="P/E Ratio" value={formatNumber(fundamentals.pe_ratio)} />
                    <FundamentalItem label="EPS" value={formatNumber(fundamentals.eps)} />
                    <FundamentalItem label="NAV" value={formatNumber(fundamentals.nav)} />
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-lg">52-Week Range</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <FundamentalItem 
                      label="52-Week High" 
                      value={formatNumber(fundamentals.week_52_high)} 
                    />
                    <FundamentalItem 
                      label="52-Week Low" 
                      value={formatNumber(fundamentals.week_52_low)} 
                    />
                    <FundamentalItem label="Face Value" value={formatNumber(fundamentals.face_value)} />
                    <FundamentalItem label="Lot Size" value={fundamentals.lot_size?.toString() || "-"} />
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-lg">Company Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <FundamentalItem label="ISIN" value={fundamentals.isin || "-"} />
                    <FundamentalItem label="Category" value={fundamentals.category || "-"} />
                    <FundamentalItem label="Market" value={fundamentals.market || "-"} />
                    <FundamentalItem label="Instrument Type" value={fundamentals.instrument_type || "-"} />
                    <FundamentalItem label="Listing Year" value={fundamentals.listing_year?.toString() || "-"} />
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-lg">Capital Structure</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <FundamentalItem label="Authorized Cap" value={formatMarketCap(fundamentals.authorized_cap)} />
                    <FundamentalItem label="Paid-up Cap" value={formatMarketCap(fundamentals.paid_up_cap)} />
                    <FundamentalItem label="Total Shares" value={fundamentals.total_shares?.toLocaleString() || "-"} />
                    <FundamentalItem 
                      label="Marginable" 
                      value={fundamentals.is_marginable ? "Yes" : "No"} 
                    />
                    <FundamentalItem 
                      label="Haircut %" 
                      value={fundamentals.haircut_pct ? `${fundamentals.haircut_pct}%` : "-"} 
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Historical Prices</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">High</TableHead>
                        <TableHead className="text-right">Low</TableHead>
                        <TableHead className="text-right">Close</TableHead>
                        <TableHead className="text-right">Volume</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            Loading...
                          </TableCell>
                        </TableRow>
                      ) : (historicalData || []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No historical data available
                          </TableCell>
                        </TableRow>
                      ) : (
                        (historicalData || []).map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{format(new Date(row.date), "MMM dd, yyyy")}</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(row.open_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(row.high_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(row.low_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(row.close_price)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {row.volume?.toLocaleString() || "-"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-end mt-4 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {historyPage}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={(historicalData || []).length < PAGE_SIZE}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
