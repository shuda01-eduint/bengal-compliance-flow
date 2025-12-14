import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Search, Filter, Loader2, Download } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TradeRecord {
  id: string;
  action: string | null;
  status: string | null;
  side: string | null;
  security_code: string | null;
  client_code: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  trade_date: string | null;
  file_name: string | null;
  uploaded_at: string;
}

export function TradeHistoryTable() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("all");
  const { toast } = useToast();

  useEffect(() => {
    fetchTrades();
    fetchFileNames();
  }, []);

  const fetchFileNames = async () => {
    const { data } = await supabase
      .from("trade_history")
      .select("file_name")
      .not("file_name", "is", null);
    
    if (data) {
      const unique = [...new Set(data.map(d => d.file_name).filter(Boolean))] as string[];
      setFileNames(unique);
    }
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("trade_history")
        .select("id, action, status, side, security_code, client_code, quantity, price, value, trade_date, file_name, uploaded_at")
        .order("uploaded_at", { ascending: false })
        .limit(500);

      const { data, error } = await query;

      if (error) throw error;
      setTrades(data || []);
    } catch (error) {
      console.error("Error fetching trades:", error);
      toast({
        title: "Error",
        description: "Failed to fetch trade history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredTrades = trades.filter((trade) => {
    const matchesSearch =
      !searchTerm ||
      trade.client_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.security_code?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSide = sideFilter === "all" || trade.side === sideFilter;

    const matchesFile = selectedFile === "all" || trade.file_name === selectedFile;

    const tradeDate = trade.trade_date ? new Date(trade.trade_date.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) : null;
    const matchesDateFrom = !dateFrom || (tradeDate && tradeDate >= dateFrom);
    const matchesDateTo = !dateTo || (tradeDate && tradeDate <= dateTo);

    return matchesSearch && matchesSide && matchesFile && matchesDateFrom && matchesDateTo;
  });

  const clearFilters = () => {
    setSearchTerm("");
    setSideFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setSelectedFile("all");
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "-";
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatTradeDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const formatted = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      return format(new Date(formatted), "dd MMM yyyy");
    } catch {
      return dateStr;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Trade History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search client/security code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={sideFilter} onValueChange={setSideFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Side" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="BUY">Buy</SelectItem>
              <SelectItem value="SELL">Sell</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedFile} onValueChange={setSelectedFile}>
            <SelectTrigger>
              <SelectValue placeholder="File" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Files</SelectItem>
              {fileNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "dd MMM yyyy") : "From date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className="pointer-events-auto" />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "dd MMM yyyy") : "To date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear Filters
          </Button>
          <span className="text-sm text-muted-foreground">
            Showing {filteredTrades.length} of {trades.length} trades
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client Code</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No trades found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTrades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell className="whitespace-nowrap">{formatTradeDate(trade.trade_date)}</TableCell>
                      <TableCell className="font-medium">{trade.client_code || "-"}</TableCell>
                      <TableCell>{trade.security_code || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={trade.side === "BUY" ? "default" : "destructive"} className="text-xs">
                          {trade.side || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{trade.quantity?.toLocaleString() || "-"}</TableCell>
                      <TableCell className="text-right">{trade.price?.toFixed(2) || "-"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(trade.value)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {trade.action || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                        {trade.file_name || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
