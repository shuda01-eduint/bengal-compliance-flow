import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Settings2, TrendingUp, TrendingDown } from "lucide-react";

interface TradeColumn {
  key: string;
  label: string;
  defaultVisible: boolean;
}

const ALL_COLUMNS: TradeColumn[] = [
  { key: "trade_date", label: "Date", defaultVisible: true },
  { key: "trade_time", label: "Time", defaultVisible: true },
  { key: "side", label: "Side", defaultVisible: true },
  { key: "security_code", label: "Security", defaultVisible: true },
  { key: "quantity", label: "Quantity", defaultVisible: true },
  { key: "price", label: "Price", defaultVisible: true },
  { key: "value", label: "Value", defaultVisible: true },
  { key: "order_id", label: "Order ID", defaultVisible: false },
  { key: "exec_id", label: "Exec ID", defaultVisible: false },
  { key: "isin", label: "ISIN", defaultVisible: false },
  { key: "board", label: "Board", defaultVisible: false },
  { key: "session", label: "Session", defaultVisible: false },
  { key: "fill_type", label: "Fill Type", defaultVisible: false },
  { key: "category", label: "Category", defaultVisible: false },
  { key: "boid", label: "BOID", defaultVisible: false },
  { key: "trader_dealer_id", label: "Trader ID", defaultVisible: false },
  { key: "owner_dealer_id", label: "Owner ID", defaultVisible: false },
  { key: "status", label: "Status", defaultVisible: false },
];

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
};

export function ClientTradeSearch() {
  const [searchCode, setSearchCode] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)
  );

  const { data: trades, isLoading } = useQuery({
    queryKey: ['client-trades', activeSearch],
    queryFn: async () => {
      if (!activeSearch) return [];
      
      const { data, error } = await supabase
        .from('trade_history')
        .select('*')
        .ilike('client_code', `%${activeSearch}%`)
        .order('trade_date', { ascending: false })
        .order('trade_time', { ascending: false })
        .limit(500);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeSearch,
  });

  const summary = useMemo(() => {
    if (!trades || trades.length === 0) return null;
    
    const buyTrades = trades.filter(t => t.side === 'BUY');
    const sellTrades = trades.filter(t => t.side === 'SELL');
    
    return {
      totalTrades: trades.length,
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      buyValue: buyTrades.reduce((sum, t) => sum + Number(t.value || 0), 0),
      sellValue: sellTrades.reduce((sum, t) => sum + Number(t.value || 0), 0),
      netValue: sellTrades.reduce((sum, t) => sum + Number(t.value || 0), 0) - 
                buyTrades.reduce((sum, t) => sum + Number(t.value || 0), 0),
    };
  }, [trades]);

  const handleSearch = () => {
    setActiveSearch(searchCode.trim().toUpperCase());
  };

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => 
      prev.includes(columnKey)
        ? prev.filter(k => k !== columnKey)
        : [...prev, columnKey]
    );
  };

  const renderCellValue = (trade: Record<string, unknown>, key: string) => {
    const value = trade[key];
    
    if (key === 'side') {
      return (
        <Badge variant={value === 'BUY' ? 'default' : 'secondary'} className={value === 'BUY' ? 'bg-success' : 'bg-destructive'}>
          {String(value)}
        </Badge>
      );
    }
    
    if (key === 'value' || key === 'price') {
      return formatCurrency(Number(value || 0));
    }
    
    if (key === 'quantity') {
      return Number(value || 0).toLocaleString();
    }
    
    return String(value || '-');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Client Trade Lookup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Bar */}
        <div className="flex gap-3">
          <Input
            placeholder="Enter client code (e.g., KL03)"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="max-w-xs"
          />
          <Button onClick={handleSearch} className="btn-gradient-gold text-primary-foreground">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          
          {/* Column Customization */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 max-h-80 overflow-y-auto" align="end">
              <div className="space-y-2">
                <p className="text-sm font-medium mb-3">Visible Columns</p>
                {ALL_COLUMNS.map(column => (
                  <div key={column.key} className="flex items-center gap-2">
                    <Checkbox
                      id={column.key}
                      checked={visibleColumns.includes(column.key)}
                      onCheckedChange={() => toggleColumn(column.key)}
                    />
                    <label htmlFor={column.key} className="text-sm cursor-pointer">
                      {column.label}
                    </label>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-secondary/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Total Trades</p>
              <p className="text-lg font-semibold">{summary.totalTrades}</p>
            </div>
            <div className="bg-success/10 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-success">
                <TrendingUp className="h-3 w-3" />
                Buy ({summary.buyCount})
              </div>
              <p className="text-lg font-semibold text-success">{formatCurrency(summary.buyValue)}</p>
            </div>
            <div className="bg-destructive/10 rounded-lg p-3">
              <div className="flex items-center gap-1 text-xs text-destructive">
                <TrendingDown className="h-3 w-3" />
                Sell ({summary.sellCount})
              </div>
              <p className="text-lg font-semibold text-destructive">{formatCurrency(summary.sellValue)}</p>
            </div>
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Net Value</p>
              <p className={`text-lg font-semibold ${summary.netValue >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(summary.netValue)}
              </p>
            </div>
          </div>
        )}

        {/* Results Table */}
        {isLoading ? (
          <div className="py-8 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-muted-foreground">Searching trades...</p>
          </div>
        ) : trades && trades.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50">
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                    <TableHead key={column.key} className="text-muted-foreground whitespace-nowrap">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id} className="hover:bg-secondary/30">
                    {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                      <TableCell key={column.key} className="whitespace-nowrap">
                        {renderCellValue(trade, column.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : activeSearch && (
          <div className="py-8 text-center text-muted-foreground">
            No trades found for "{activeSearch}"
          </div>
        )}

        {trades && trades.length >= 500 && (
          <p className="text-xs text-muted-foreground text-center">
            Showing first 500 trades. Use more specific search for complete results.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
