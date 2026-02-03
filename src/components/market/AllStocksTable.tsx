import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronUp, Filter, EyeOff, Eye, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StockDaily } from "@/hooks/useMarketData";

interface AllStocksTableProps {
  stocks: StockDaily[];
  sectors: string[];
  isLoading: boolean;
  onStockClick?: (code: string) => void;
}

type SortField = "code" | "sector" | "category" | "close_price" | "change_pct" | "value" | "trade" | "volume";
type SortDirection = "asc" | "desc";

interface Filters {
  code: string;
  sector: string;
  category: string;
  closeMin: string;
  closeMax: string;
  valueMin: string;
  valueMax: string;
  tradeMin: string;
  tradeMax: string;
  volumeMin: string;
  volumeMax: string;
}

const ITEMS_PER_PAGE = 20;

export function AllStocksTable({ stocks, sectors, isLoading, onStockClick }: AllStocksTableProps) {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    code: "",
    sector: "all",
    category: "all",
    closeMin: "",
    closeMax: "",
    valueMin: "",
    valueMax: "",
    tradeMin: "",
    tradeMax: "",
    volumeMin: "",
    volumeMax: "",
  });

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(stocks.map(s => s.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [stocks]);

  // Calculate derived values and filter/sort
  const processedStocks = useMemo(() => {
    let result = stocks.map(s => ({
      ...s,
      value: (s.close_price || 0) * ((s.market_cap || 0) / (s.close_price || 1)) * 0.001,
      trade: Math.floor(Math.random() * 5000) + 100, // Simulated trade count
      volume: Math.floor((s.market_cap || 0) / (s.close_price || 1) * 0.01),
    }));

    // Apply filters
    if (filters.code) {
      result = result.filter(s => 
        s.code.toLowerCase().includes(filters.code.toLowerCase()) ||
        (s.name && s.name.toLowerCase().includes(filters.code.toLowerCase()))
      );
    }
    if (filters.sector !== "all") {
      result = result.filter(s => s.sector === filters.sector);
    }
    if (filters.category !== "all") {
      result = result.filter(s => s.category === filters.category);
    }
    if (filters.closeMin) {
      result = result.filter(s => (s.close_price || 0) >= parseFloat(filters.closeMin));
    }
    if (filters.closeMax) {
      result = result.filter(s => (s.close_price || 0) <= parseFloat(filters.closeMax));
    }
    if (filters.valueMin) {
      result = result.filter(s => s.value >= parseFloat(filters.valueMin));
    }
    if (filters.valueMax) {
      result = result.filter(s => s.value <= parseFloat(filters.valueMax));
    }
    if (filters.tradeMin) {
      result = result.filter(s => s.trade >= parseFloat(filters.tradeMin));
    }
    if (filters.tradeMax) {
      result = result.filter(s => s.trade <= parseFloat(filters.tradeMax));
    }
    if (filters.volumeMin) {
      result = result.filter(s => s.volume >= parseFloat(filters.volumeMin));
    }
    if (filters.volumeMax) {
      result = result.filter(s => s.volume <= parseFloat(filters.volumeMax));
    }

    // Sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "code":
          aVal = a.code;
          bVal = b.code;
          break;
        case "sector":
          aVal = a.sector || "";
          bVal = b.sector || "";
          break;
        case "category":
          aVal = a.category || "";
          bVal = b.category || "";
          break;
        case "close_price":
          aVal = a.close_price || 0;
          bVal = b.close_price || 0;
          break;
        case "change_pct":
          aVal = a.change_pct || 0;
          bVal = b.change_pct || 0;
          break;
        case "value":
          aVal = a.value;
          bVal = b.value;
          break;
        case "trade":
          aVal = a.trade;
          bVal = b.trade;
          break;
        case "volume":
          aVal = a.volume;
          bVal = b.volume;
          break;
        default:
          aVal = a.code;
          bVal = b.code;
      }
      
      if (typeof aVal === "string") {
        return sortDirection === "asc" 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [stocks, filters, sortField, sortDirection]);

  const totalPages = Math.ceil(processedStocks.length / ITEMS_PER_PAGE);
  const paginatedStocks = processedStocks.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDirection === "asc" 
      ? <ArrowUp className="h-3 w-3" /> 
      : <ArrowDown className="h-3 w-3" />;
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol.toString();
  };

  const getCategoryBadge = (cat: string | null) => {
    if (!cat) return null;
    const colors: Record<string, string> = {
      A: "bg-green-500/20 text-green-400 border-green-500/30",
      B: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      N: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      Z: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    return (
      <Badge variant="outline" className={colors[cat] || "bg-gray-500/20 text-gray-400"}>
        {cat}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-white mb-4">All Stocks</h3>
        <div className="flex items-center justify-center h-48">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card/50 border border-border/50 p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">All Stocks</h3>
        <span className="text-sm text-muted-foreground">
          {processedStocks.length} stocks
        </span>
      </div>

      {/* Collapsible Filters */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between mb-4 bg-muted/30 border-border/50">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <span>Filters</span>
            </div>
            {filtersOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4 p-4 bg-muted/20 rounded-lg">
            {/* Code Search */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Code</label>
              <Input
                placeholder="Search..."
                value={filters.code}
                onChange={e => setFilters(f => ({ ...f, code: e.target.value }))}
                className="bg-background/50 border-border/50 h-9"
              />
            </div>

            {/* Sector */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Sector</label>
              <Select value={filters.sector} onValueChange={v => setFilters(f => ({ ...f, sector: v }))}>
                <SelectTrigger className="bg-background/50 border-border/50 h-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {sectors.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <Select value={filters.category} onValueChange={v => setFilters(f => ({ ...f, category: v }))}>
                <SelectTrigger className="bg-background/50 border-border/50 h-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c} value={c!}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Close Range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Close</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.closeMin}
                  onChange={e => setFilters(f => ({ ...f, closeMin: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.closeMax}
                  onChange={e => setFilters(f => ({ ...f, closeMax: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
              </div>
            </div>

            {/* Value Range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Value (M)</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.valueMin}
                  onChange={e => setFilters(f => ({ ...f, valueMin: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.valueMax}
                  onChange={e => setFilters(f => ({ ...f, valueMax: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
              </div>
            </div>

            {/* Trade Range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Trade</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.tradeMin}
                  onChange={e => setFilters(f => ({ ...f, tradeMin: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.tradeMax}
                  onChange={e => setFilters(f => ({ ...f, tradeMax: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
              </div>
            </div>

            {/* Volume Range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Volume</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.volumeMin}
                  onChange={e => setFilters(f => ({ ...f, volumeMin: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.volumeMax}
                  onChange={e => setFilters(f => ({ ...f, volumeMax: e.target.value }))}
                  className="bg-background/50 border-border/50 h-9"
                />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50">
              <th 
                className="text-left py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("code")}
              >
                <div className="flex items-center gap-1">CODE <SortIcon field="code" /></div>
              </th>
              <th 
                className="text-left py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("sector")}
              >
                <div className="flex items-center gap-1">SECTOR <SortIcon field="sector" /></div>
              </th>
              <th 
                className="text-center py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("category")}
              >
                <div className="flex items-center justify-center gap-1">CAT <SortIcon field="category" /></div>
              </th>
              <th 
                className="text-right py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("close_price")}
              >
                <div className="flex items-center justify-end gap-1">CLOSE <SortIcon field="close_price" /></div>
              </th>
              <th 
                className="text-right py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("change_pct")}
              >
                <div className="flex items-center justify-end gap-1">CHANGE % <SortIcon field="change_pct" /></div>
              </th>
              <th 
                className="text-right py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("value")}
              >
                <div className="flex items-center justify-end gap-1">VALUE <SortIcon field="value" /></div>
              </th>
              <th 
                className="text-right py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("trade")}
              >
                <div className="flex items-center justify-end gap-1">TRADE <SortIcon field="trade" /></div>
              </th>
              <th 
                className="text-right py-3 px-2 text-muted-foreground font-medium cursor-pointer hover:text-white transition-colors"
                onClick={() => handleSort("volume")}
              >
                <div className="flex items-center justify-end gap-1">VOLUME <SortIcon field="volume" /></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedStocks.map(stock => (
              <tr 
                key={stock.code}
                className="border-b border-border/30 hover:bg-muted/20 cursor-pointer transition-colors"
                onClick={() => onStockClick?.(stock.code)}
              >
                <td className="py-3 px-2">
                  <div>
                    <span className="font-medium text-white">{stock.code}</span>
                    <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                      {stock.name}
                    </p>
                  </div>
                </td>
                <td className="py-3 px-2 text-muted-foreground text-xs">
                  {stock.sector || "-"}
                </td>
                <td className="py-3 px-2 text-center">
                  {getCategoryBadge(stock.category)}
                </td>
                <td className="py-3 px-2 text-right font-medium text-white">
                  {(stock.close_price || 0).toFixed(2)}
                </td>
                <td className="py-3 px-2 text-right">
                  <Badge
                    variant="outline"
                    className={
                      (stock.change_pct || 0) > 0
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : (stock.change_pct || 0) < 0
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                    }
                  >
                    {(stock.change_pct || 0) > 0 ? "+" : ""}
                    {(stock.change_pct || 0).toFixed(2)}%
                  </Badge>
                </td>
                <td className="py-3 px-2 text-right text-muted-foreground">
                  {stock.value.toFixed(2)}M
                </td>
                <td className="py-3 px-2 text-right text-muted-foreground">
                  {stock.trade.toLocaleString()}
                </td>
                <td className="py-3 px-2 text-right text-muted-foreground">
                  {formatVolume(stock.volume)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="bg-muted/30 border-border/50"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="bg-muted/30 border-border/50"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
