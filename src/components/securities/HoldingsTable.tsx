import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Search, RefreshCw, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as XLSX from "xlsx";
import { HoldingRecordSchema, sanitizeString } from "@/lib/validation-schemas";

interface Holding {
  id: string;
  trading_code: string;
  investor_code: string;
  boid: string | null;
  investor_name: string | null;
  total_stock: number | null;
  saleable: number | null;
  avg_cost: number | null;
  total_cost: number | null;
  market_value: number | null;
  ledger_balance: number | null;
  rm_email: string | null;
  created_at: string;
  updated_at: string;
}

export function HoldingsTable() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rmFilter, setRmFilter] = useState("all");
  const [rmEmails, setRmEmails] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchHoldings();
  }, [searchTerm, rmFilter, currentPage, pageSize]);

  useEffect(() => {
    fetchRmEmails();
  }, []);

  const fetchRmEmails = async () => {
    try {
      const { data } = await supabase
        .from("holdings")
        .select("rm_email")
        .not("rm_email", "is", null);
      
      if (data) {
        const uniqueEmails = [...new Set(data.map(d => d.rm_email).filter(Boolean))] as string[];
        setRmEmails(uniqueEmails.sort());
      }
    } catch (error) {
      console.error("Error fetching RM emails:", error);
    }
  };

  const fetchHoldings = async () => {
    setLoading(true);
    try {
      let query = supabase.from("holdings").select("*", { count: "exact" });

      if (searchTerm) {
        query = query.or(`trading_code.ilike.%${searchTerm}%,investor_code.ilike.%${searchTerm}%,investor_name.ilike.%${searchTerm}%`);
      }

      if (rmFilter !== "all") {
        query = query.eq("rm_email", rmFilter);
      }

      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order("trading_code", { ascending: true })
        .range(from, to);

      if (error) throw error;

      setHoldings(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error fetching holdings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch holdings data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const parseNumericValue = (value: any): number | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return value;
    const cleaned = value.toString().replace(/,/g, "").trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      if (jsonData.length < 2) {
        throw new Error("File is empty or has no data rows");
      }

      const headers = jsonData[0].map((h: any) => h?.toString().trim().toLowerCase());
      
      // Detect format: Instrument-grouped format or flat CSV
      const isInstrumentFormat = headers.includes("investor code") && 
        jsonData.some(row => row[0]?.toString().startsWith("Instrument Name :"));

      const validRecords: any[] = [];
      const validationErrors: string[] = [];
      const chunkSize = 500;

      if (isInstrumentFormat) {
        // Parse instrument-grouped format (Excel with "Instrument Name :" rows)
        let currentTradingCode: string | null = null;
        
        // Find column indices
        const colIndices = {
          investor_code: headers.indexOf("investor code"),
          boid: headers.indexOf("boid"),
          investor_name: headers.indexOf("investor name"),
          total_stock: headers.indexOf("totalstock"),
          saleable: headers.indexOf("saleable"),
          avg_cost: headers.indexOf("avgcost"),
          total_cost: headers.indexOf("total cost"),
          market_value: headers.indexOf("total m.v."),
          ledger_balance: headers.indexOf("ledger balance"),
        };

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const firstCell = row[0]?.toString().trim() || "";
          
          // Check for instrument name row
          if (firstCell.startsWith("Instrument Name :")) {
            currentTradingCode = firstCell.replace("Instrument Name :", "").trim();
            continue;
          }

          // Skip total/summary rows
          if (firstCell === "Total" || firstCell === "") continue;

          // Skip if no trading code set yet
          if (!currentTradingCode) continue;

          const investorCode = row[colIndices.investor_code]?.toString().trim();
          if (!investorCode) continue;

          const rawRecord: Record<string, unknown> = {
            trading_code: currentTradingCode,
            investor_code: investorCode,
            boid: colIndices.boid >= 0 ? (row[colIndices.boid]?.toString().trim() || null) : null,
            investor_name: colIndices.investor_name >= 0 ? sanitizeString(row[colIndices.investor_name]?.toString() || "") : null,
            total_stock: colIndices.total_stock >= 0 ? parseNumericValue(row[colIndices.total_stock]) : null,
            saleable: colIndices.saleable >= 0 ? parseNumericValue(row[colIndices.saleable]) : null,
            avg_cost: colIndices.avg_cost >= 0 ? parseNumericValue(row[colIndices.avg_cost]) : null,
            total_cost: colIndices.total_cost >= 0 ? parseNumericValue(row[colIndices.total_cost]) : null,
            market_value: colIndices.market_value >= 0 ? parseNumericValue(row[colIndices.market_value]) : null,
            ledger_balance: colIndices.ledger_balance >= 0 ? parseNumericValue(row[colIndices.ledger_balance]) : null,
          };

          const result = HoldingRecordSchema.safeParse(rawRecord);
          if (result.success) {
            validRecords.push(result.data);
          } else if (validationErrors.length < 10) {
            validationErrors.push(`Row ${i}: ${result.error.errors.map(e => e.message).join(', ')}`);
          }

          if (i % 1000 === 0) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }
      } else {
        // Parse flat CSV format (original logic)
        const columnMap: Record<string, string> = {
          "stock as on date instrumentwise": "trading_code",
          "trading code": "trading_code",
          "investor code": "investor_code",
          "boid": "boid",
          "investor name": "investor_name",
          "totalstock": "total_stock",
          "total stock": "total_stock",
          "saleable": "saleable",
          "avgcost": "avg_cost",
          "avg cost": "avg_cost",
          "total cost": "total_cost",
          "total m.v.": "market_value",
          "market value": "market_value",
          "ledger balance": "ledger_balance",
        };

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const rawRecord: Record<string, unknown> = {};
          headers.forEach((header: string, index: number) => {
            const dbColumn = columnMap[header];
            if (dbColumn) {
              const value = row[index];
              if (["total_stock", "saleable", "avg_cost", "total_cost", "market_value", "ledger_balance"].includes(dbColumn)) {
                rawRecord[dbColumn] = parseNumericValue(value);
              } else {
                rawRecord[dbColumn] = typeof value === 'string' ? sanitizeString(value) : (value?.toString().trim() || null);
              }
            }
          });

          const result = HoldingRecordSchema.safeParse(rawRecord);
          if (result.success) {
            validRecords.push(result.data);
          } else if (validationErrors.length < 10) {
            validationErrors.push(`Row ${i}: ${result.error.errors.map(e => e.message).join(', ')}`);
          }

          if (i % 1000 === 0) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }
      }

      if (validationErrors.length > 0) {
        console.warn('Validation warnings:', validationErrors);
      }

      // Clear existing data before import
      await supabase.from("holdings").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      // Insert in chunks with UI yields
      let inserted = 0;
      for (let i = 0; i < validRecords.length; i += chunkSize) {
        const chunk = validRecords.slice(i, i + chunkSize);
        const { error } = await supabase.from("holdings").insert(chunk);
        if (error) throw error;
        
        inserted += chunk.length;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      toast({
        title: "Import Successful",
        description: `Imported ${inserted} holdings records`,
      });

      fetchHoldings();
      fetchRmEmails();
    } catch (error: any) {
      console.error("Import error:", error);
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleExport = () => {
    const exportData = holdings.map((h) => ({
      "Trading Code": h.trading_code,
      "Investor Code": h.investor_code,
      "BOID": h.boid,
      "Investor Name": h.investor_name,
      "Total Stock": h.total_stock,
      "Saleable": h.saleable,
      "Avg Cost": h.avg_cost,
      "Total Cost": h.total_cost,
      "Market Value": h.market_value,
      "Ledger Balance": h.ledger_balance,
      "RM Email": h.rm_email,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Holdings");
    XLSX.writeFile(wb, `holdings_export_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchTerm("");
    setRmFilter("all");
    setCurrentPage(1);
  };

  const formatNumber = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatInteger = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString("en-US");
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">Holdings Inventory</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={holdings.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <label>
              <Button size="sm" asChild disabled={uploading}>
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Importing..." : "Import CSV"}
                </span>
              </Button>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code, name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={rmFilter} onValueChange={(v) => { setRmFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by RM" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All RMs</SelectItem>
              {rmEmails.map((email) => (
                <SelectItem key={email} value={email}>{email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>

        {/* Results count */}
        <div className="text-sm text-muted-foreground">
          Showing {holdings.length} of {totalCount.toLocaleString()} holdings
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="min-w-[120px]">Trading Code</TableHead>
                <TableHead className="min-w-[100px]">Investor Code</TableHead>
                <TableHead className="min-w-[150px]">Investor Name</TableHead>
                <TableHead className="min-w-[100px] text-right">Total Stock</TableHead>
                <TableHead className="min-w-[100px] text-right">Saleable</TableHead>
                <TableHead className="min-w-[100px] text-right">Avg Cost</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Cost</TableHead>
                <TableHead className="min-w-[120px] text-right">Market Value</TableHead>
                <TableHead className="min-w-[120px] text-right">Ledger Balance</TableHead>
                <TableHead className="min-w-[180px]">RM Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : holdings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No holdings found. Import a CSV file to get started.
                  </TableCell>
                </TableRow>
              ) : (
                holdings.map((holding) => (
                  <TableRow key={holding.id}>
                    <TableCell className="font-medium">{holding.trading_code}</TableCell>
                    <TableCell>{holding.investor_code}</TableCell>
                    <TableCell>{holding.investor_name || "-"}</TableCell>
                    <TableCell className="text-right">{formatInteger(holding.total_stock)}</TableCell>
                    <TableCell className="text-right">{formatInteger(holding.saleable)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.avg_cost)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.total_cost)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.market_value)}</TableCell>
                    <TableCell className="text-right">{formatNumber(holding.ledger_balance)}</TableCell>
                    <TableCell>{holding.rm_email || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
              <SelectTrigger className="w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((size) => (
                  <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
