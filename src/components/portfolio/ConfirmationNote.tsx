import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { useState } from "react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface ConfirmationNoteProps {
  investorCode: string;
  investorName: string;
  boId: string | null;
  phone?: string | null;
  address?: string | null;
  openingBalance: number;
}

interface TradeGroup {
  security_code: string;
  quantity: number;
  totalValue: number;
  commission: number;
  avgRateBefore: number;
  avgRateAfter: number;
  balance: number;
}

export function ConfirmationNote({
  investorCode,
  investorName,
  boId,
  phone,
  address,
  openingBalance,
}: ConfirmationNoteProps) {
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const tradeDateStr = format(selectedDate, "yyyyMMdd");

  // Fetch trades for the selected date
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["confirmation-trades", investorCode, tradeDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trade_history")
        .select("security_code, side, quantity, price, value, brokerage_commission")
        .eq("client_code", investorCode)
        .eq("trade_date", tradeDateStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investorCode,
  });

  // Fetch deposits/withdrawals for the selected date
  const { data: transactions = [] } = useQuery({
    queryKey: ["confirmation-transactions", investorCode, tradeDateStr],
    queryFn: async () => {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("deposits_withdrawals")
        .select("transaction_type, amount")
        .eq("investor_code", investorCode)
        .eq("transaction_date", dateStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investorCode,
  });

  // Group trades by side and security
  const groupTrades = (side: string): TradeGroup[] => {
    const filtered = trades.filter((t) => t.side === side && t.quantity > 0);
    const grouped = new Map<string, { qty: number; value: number; commission: number }>();

    filtered.forEach((t) => {
      const key = t.security_code || "UNKNOWN";
      const existing = grouped.get(key) || { qty: 0, value: 0, commission: 0 };
      existing.qty += t.quantity || 0;
      existing.value += t.value || 0;
      existing.commission += (t.value || 0) * (t.brokerage_commission || 0);
      grouped.set(key, existing);
    });

    return Array.from(grouped.entries()).map(([code, data]) => ({
      security_code: code,
      quantity: data.qty,
      totalValue: data.value,
      commission: data.commission,
      avgRateBefore: data.qty > 0 ? data.value / data.qty : 0,
      avgRateAfter: data.qty > 0 ? (data.value + data.commission) / data.qty : 0,
      balance: data.value + data.commission,
    }));
  };

  const buyTrades = groupTrades("BUY");
  const sellTrades = groupTrades("SELL");

  const totalBuy = buyTrades.reduce(
    (acc, t) => ({
      value: acc.value + t.totalValue,
      commission: acc.commission + t.commission,
      balance: acc.balance + t.balance,
    }),
    { value: 0, commission: 0, balance: 0 }
  );

  const totalSell = sellTrades.reduce(
    (acc, t) => ({
      value: acc.value + t.totalValue,
      commission: acc.commission + t.commission,
      balance: acc.balance + t.balance,
    }),
    { value: 0, commission: 0, balance: 0 }
  );

  // Net calculations
  const netBuySaleAmount = totalSell.value - totalBuy.value - totalBuy.commission - totalSell.commission;
  const totalDeposits = transactions
    .filter((t) => t.transaction_type === "Deposit")
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalWithdrawals = transactions
    .filter((t) => t.transaction_type === "Withdrawal")
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const netDeposit = totalDeposits - totalWithdrawals;
  const closingBalance = openingBalance + netBuySaleAmount + netDeposit;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-BD", { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-BD", { minimumFractionDigits: 0 }).format(value);

  const numberToWords = (num: number): string => {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
    const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    const convert = (n: number): string => {
      if (n === 0) return "";
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
      if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + convert(n % 100) : "");
      if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
      if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakhs" + (n % 100000 ? " " + convert(n % 100000) : "");
      return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + convert(n % 10000000) : "");
    };

    const intPart = Math.floor(Math.abs(num));
    const decPart = Math.round((Math.abs(num) - intPart) * 100);
    let result = convert(intPart) + " Taka";
    if (decPart > 0) result += " and " + convert(decPart) + " Paisa";
    return result + " only.";
  };

  const handleExport = () => {
    const data: any[] = [];
    
    // BUY trades
    buyTrades.forEach((t) => {
      data.push({
        Type: "BUY",
        InstrumentCode: t.security_code,
        Quantity: t.quantity,
        "Before Commission Rate": t.avgRateBefore,
        "After Commission Rate": t.avgRateAfter,
        Amount: t.totalValue,
        Commission: t.commission,
        Balance: t.balance,
      });
    });
    
    // SELL trades
    sellTrades.forEach((t) => {
      data.push({
        Type: "SELL",
        InstrumentCode: t.security_code,
        Quantity: t.quantity,
        "Before Commission Rate": t.avgRateBefore,
        "After Commission Rate": t.avgRateAfter,
        Amount: t.totalValue,
        Commission: t.commission,
        Balance: t.balance,
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Confirmation Note");
    XLSX.writeFile(wb, `ConfirmationNote_${investorCode}_${tradeDateStr}.xlsx`);
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Confirmation Note of Securities [Buy & Sale]</CardTitle>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "dd-MMM-yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-card border-border z-50">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Header Info */}
        <div className="grid grid-cols-2 gap-4 text-sm border-b border-border pb-4">
          <div className="space-y-1">
            <p className="font-semibold">From: UCB Stock Brokerage Limited.</p>
            <p className="text-muted-foreground">(+88) 09678-175175</p>
            <p className="text-muted-foreground text-xs">
              "BULUS CENTER" (17th floor, west side), Plot-CWS(A)1, Road No-34, Gulshan Avenue
            </p>
          </div>
          <div className="space-y-1 text-right">
            <p>
              <span className="text-muted-foreground">Investor Code: </span>
              <span className="font-semibold">{investorCode}</span>
              {boId && (
                <>
                  <span className="text-muted-foreground ml-4">BOID: </span>
                  <span className="font-semibold">{boId}</span>
                </>
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Investor Name: </span>
              <span className="font-semibold">{investorName}</span>
            </p>
            {phone && (
              <p>
                <span className="text-muted-foreground">Phone: </span>
                <span>{phone}</span>
              </p>
            )}
            {address && (
              <p className="text-xs">
                <span className="text-muted-foreground">Address: </span>
                <span>{address}</span>
              </p>
            )}
          </div>
        </div>

        <p className="text-sm text-center text-muted-foreground">
          with reference to your Order No as stated below dated {format(selectedDate, "yyyy-MM-dd")} we have
          purchased/sold the following securities
        </p>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading trades...</div>
        ) : buyTrades.length === 0 && sellTrades.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No trades found for this date</div>
        ) : (
          <>
            {/* Trades Table */}
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-foreground">InstrumentCode</TableHead>
                    <TableHead className="text-foreground text-right">Quantity</TableHead>
                    <TableHead className="text-foreground text-right">Before Commission Avg Rate</TableHead>
                    <TableHead className="text-foreground text-right">After Commission Avg Rate</TableHead>
                    <TableHead className="text-foreground text-right">Amount</TableHead>
                    <TableHead className="text-foreground text-right">Brokerage Commission</TableHead>
                    <TableHead className="text-foreground text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* DHAKA STOCK EXCHANGE LTD */}
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={7} className="font-semibold">
                      DHAKA STOCK EXCHANGE LTD.
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={7} className="font-medium">
                      Public Market
                    </TableCell>
                  </TableRow>

                  {/* BUY Section */}
                  {buyTrades.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={7} className="font-semibold text-green-600">
                          BUY
                        </TableCell>
                      </TableRow>
                      {buyTrades.map((t, i) => (
                        <TableRow key={`buy-${i}`} className="hover:bg-muted/30">
                          <TableCell className="pl-8">{t.security_code}</TableCell>
                          <TableCell className="text-right">{formatNumber(t.quantity)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.avgRateBefore)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.avgRateAfter)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.totalValue)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.commission)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.balance)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/20 font-semibold">
                        <TableCell colSpan={4} className="text-right">
                          Total BUY :
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(totalBuy.value)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalBuy.commission)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalBuy.balance)}</TableCell>
                      </TableRow>
                    </>
                  )}

                  {/* SALE Section */}
                  {sellTrades.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={7} className="font-semibold text-red-600">
                          SALE
                        </TableCell>
                      </TableRow>
                      {sellTrades.map((t, i) => (
                        <TableRow key={`sell-${i}`} className="hover:bg-muted/30">
                          <TableCell className="pl-8">{t.security_code}</TableCell>
                          <TableCell className="text-right">{formatNumber(t.quantity)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.avgRateBefore)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.avgRateAfter)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.totalValue)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.commission)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(t.balance)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/20 font-semibold">
                        <TableCell colSpan={4} className="text-right">
                          Total SALE :
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(totalSell.value)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalSell.commission)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalSell.balance)}</TableCell>
                      </TableRow>
                    </>
                  )}

                  {/* Exchange Total */}
                  <TableRow className="bg-primary/10 font-semibold">
                    <TableCell colSpan={4} className="text-right">
                      Exchange Total :
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totalBuy.value + totalSell.value)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalBuy.commission + totalSell.commission)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalBuy.balance + totalSell.balance)}
                    </TableCell>
                  </TableRow>

                  {/* Grand Total */}
                  <TableRow className="bg-primary/20 font-bold">
                    <TableCell colSpan={4} className="text-right">
                      Grand Total :
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totalBuy.value + totalSell.value)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalBuy.commission + totalSell.commission)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totalBuy.balance + totalSell.balance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Netting Summary */}
            <div className="space-y-2 border border-border rounded-md p-4 bg-muted/20">
              <div className="flex justify-between">
                <span className="font-semibold">Buy/Sale Netting Amount :</span>
                <span className="font-mono">{formatCurrency(Math.abs(netBuySaleAmount))}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">
                  {netBuySaleAmount >= 0 ? "Receivable from Broker:" : "Payable to Broker:"}
                </span>
                <span className="font-mono">{formatCurrency(Math.abs(netBuySaleAmount))}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Taka In Words :</span>
                <span>{numberToWords(Math.abs(netBuySaleAmount))}</span>
              </div>
            </div>

            {/* Balance Summary */}
            <div className="grid grid-cols-2 gap-4 border border-border rounded-md p-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Opening Balance</span>
                  <span className="font-mono">: {formatCurrency(openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Buy/Sale Netting Amount</span>
                  <span className="font-mono">: {formatCurrency(netBuySaleAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Withdraw/Deposit</span>
                  <span className="font-mono">: {formatCurrency(netDeposit)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-border pt-2">
                  <span>Closing Balance</span>
                  <span className="font-mono">: {formatCurrency(closingBalance)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
