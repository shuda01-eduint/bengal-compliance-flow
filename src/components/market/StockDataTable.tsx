import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { StockDaily } from "@/hooks/useMarketData";
import { cn } from "@/lib/utils";

interface StockDataTableProps {
  stocks: StockDaily[];
  sectors: string[];
  isLoading: boolean;
  onStockClick: (code: string) => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  selectedSector: string;
  onSectorChange: (sector: string) => void;
}

type SortField = "code" | "close_price" | "change" | "change_pct" | "market_cap" | "pe_ratio";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 20;

export function StockDataTable({
  stocks,
  sectors,
  isLoading,
  onStockClick,
  selectedDate,
  onDateChange,
  selectedSector,
  onSectorChange,
}: StockDataTableProps) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredAndSortedStocks = useMemo(() => {
    let result = [...stocks];

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (stock) =>
          stock.code.toLowerCase().includes(searchLower) ||
          stock.name?.toLowerCase().includes(searchLower) ||
          stock.sector?.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (aVal === null || aVal === undefined) aVal = sortField === "code" ? "" : 0;
      if (bVal === null || bVal === undefined) bVal = sortField === "code" ? "" : 0;

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return result;
  }, [stocks, search, sortField, sortDirection]);

  const totalPages = Math.ceil(filteredAndSortedStocks.length / PAGE_SIZE);
  const paginatedStocks = filteredAndSortedStocks.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const formatNumber = (value: number | null, decimals = 2) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatMarketCap = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    return value.toLocaleString();
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 hover:bg-muted"
      onClick={() => handleSort(field)}
    >
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg">Market Overview</CardTitle>
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code, name, or sector..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full sm:w-40"
          />
          <Select value={selectedSector} onValueChange={onSectorChange}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Sectors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sectors</SelectItem>
              {sectors.map((sector) => (
                <SelectItem key={sector} value={sector}>
                  {sector}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[100px]">
                  <SortButton field="code">Code</SortButton>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">
                  <SortButton field="close_price">Price</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="change">Change</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="change_pct">Change %</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="market_cap">Mkt Cap</SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton field="pe_ratio">P/E</SortButton>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading stocks...
                  </TableCell>
                </TableRow>
              ) : paginatedStocks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No stocks found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedStocks.map((stock) => (
                  <TableRow
                    key={stock.code}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => onStockClick(stock.code)}
                  >
                    <TableCell className="font-medium">{stock.code}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={stock.name || undefined}>
                      {stock.name || "-"}
                    </TableCell>
                    <TableCell>
                      {stock.sector ? (
                        <Badge variant="outline" className="text-xs">
                          {stock.sector}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(stock.close_price)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        (stock.change || 0) > 0
                          ? "text-green-500"
                          : (stock.change || 0) < 0
                          ? "text-red-500"
                          : ""
                      )}
                    >
                      {(stock.change || 0) > 0 ? "+" : ""}
                      {formatNumber(stock.change)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        (stock.change_pct || 0) > 0
                          ? "text-green-500"
                          : (stock.change_pct || 0) < 0
                          ? "text-red-500"
                          : ""
                      )}
                    >
                      {(stock.change_pct || 0) > 0 ? "+" : ""}
                      {formatNumber(stock.change_pct)}%
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMarketCap(stock.market_cap)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(stock.pe_ratio)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1} to{" "}
              {Math.min(currentPage * PAGE_SIZE, filteredAndSortedStocks.length)} of{" "}
              {filteredAndSortedStocks.length} stocks
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
