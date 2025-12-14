import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Search, Trash2, Download, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import {
  DepositsWithdrawalsRecordSchema,
  validateRecords,
  type DepositsWithdrawalsRecord,
} from "@/lib/validation-schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DepositWithdrawal {
  id: string;
  investor_code: string;
  investor_name: string | null;
  transaction_type: string;
  amount: number;
  transaction_date: string;
  remarks: string | null;
  rm_email: string | null;
  uploaded_at: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const DepositsWithdrawalsTable = () => {
  const [transactions, setTransactions] = useState<DepositWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedSearch, typeFilter, pageSize]);

  // Fetch total count
  const fetchTotalCount = async () => {
    let query = supabase
      .from("deposits_withdrawals")
      .select("*", { count: "exact", head: true });

    if (debouncedSearch) {
      query = query.or(
        `investor_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%`
      );
    }

    if (typeFilter !== "all") {
      query = query.eq("transaction_type", typeFilter);
    }

    const { count } = await query;
    setTotalCount(count || 0);
  };

  // Fetch transactions
  const fetchTransactions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("deposits_withdrawals")
        .select("*")
        .order("transaction_date", { ascending: false })
        .range(currentPage * pageSize, (currentPage + 1) * pageSize - 1);

      if (debouncedSearch) {
        query = query.or(
          `investor_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%`
        );
      }

      if (typeFilter !== "all") {
        query = query.eq("transaction_type", typeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      toast.error("Failed to fetch transactions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTotalCount();
    fetchTransactions();
  }, [debouncedSearch, typeFilter, currentPage, pageSize]);

  const parseNumber = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[,\s]/g, "");
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error("No data found in file");
        return;
      }

      // Log first row to help debug column names
      console.log("Excel columns found:", Object.keys(jsonData[0] as object));
      console.log("First row sample:", jsonData[0]);

      // Map Excel columns to database fields with flexible column name matching
      const mappedRecords = jsonData.map((row: any) => {
        // Find investor code - check various possible column names
        const investorCode = String(
          row["Investor Code"] || 
          row["investor_code"] || 
          row["InvCode"] || 
          row["Inv Code"] ||
          row["Client Code"] ||
          row["client_code"] ||
          row["Code"] ||
          ""
        ).trim();

        // Find transaction type
        const transactionType = String(
          row["Transaction Type"] ||
            row["transaction_type"] ||
            row["Type"] ||
            row["Trans Type"] ||
            row["TransType"] ||
            ""
        ).trim();

        // Parse amount - handle various formats
        const rawAmount = row["Amount"] || row["amount"] || row["Amt"] || 0;
        const amount = parseNumber(rawAmount);

        // Find date
        let transactionDate = 
          row["Transaction Date"] ||
          row["transaction_date"] ||
          row["Date"] ||
          row["Trans Date"] ||
          row["TransDate"] ||
          null;
        
        // Handle Excel date serial numbers
        if (typeof transactionDate === "number") {
          const excelDate = XLSX.SSF.parse_date_code(transactionDate);
          if (excelDate) {
            transactionDate = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
          }
        }

        return {
          investor_code: investorCode,
          investor_name:
            row["Investor Name"] || row["investor_name"] || row["Name"] || row["Client Name"] || null,
          transaction_type: transactionType,
          amount: amount,
          transaction_date: transactionDate || format(new Date(), "yyyy-MM-dd"),
          remarks: row["Remarks"] || row["remarks"] || row["Notes"] || row["Comment"] || null,
          rm_email:
            row["RM Email"] || row["rm_email"] || row["RM_Email"] || row["RM"] || null,
        };
      });

      console.log("Mapped records sample:", mappedRecords[0]);


      // Validate records
      const { valid, errors } = validateRecords(
        mappedRecords,
        DepositsWithdrawalsRecordSchema
      );

      if (errors.length > 0) {
        toast.warning(`${errors.length} rows had validation issues`, {
          description: errors.slice(0, 3).join("\n"),
        });
      }

      if (valid.length === 0) {
        toast.error("No valid records to import");
        return;
      }

      // Insert in batches
      const BATCH_SIZE = 500;
      let inserted = 0;

      for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE).map((record) => ({
          investor_code: record.investor_code,
          transaction_type: record.transaction_type,
          amount: record.amount,
          transaction_date: record.transaction_date || format(new Date(), "yyyy-MM-dd"),
          investor_name: record.investor_name || null,
          rm_email: record.rm_email || null,
          remarks: record.remarks || null,
        }));
        const { error } = await supabase
          .from("deposits_withdrawals")
          .insert(batch);

        if (error) throw error;
        inserted += batch.length;

        // Yield to UI
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      toast.success(`Imported ${inserted} transactions`);
      fetchTotalCount();
      fetchTransactions();
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error("Import failed", { description: error.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleClearAll = async () => {
    try {
      const { error } = await supabase
        .from("deposits_withdrawals")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (error) throw error;

      toast.success("All transactions cleared");
      fetchTotalCount();
      fetchTransactions();
    } catch (error: any) {
      console.error("Clear error:", error);
      toast.error("Failed to clear transactions", {
        description: error.message,
      });
    }
  };

  const handleExport = () => {
    if (transactions.length === 0) {
      toast.error("No data to export");
      return;
    }

    const exportData = transactions.map((t) => ({
      "Investor Code": t.investor_code,
      "Investor Name": t.investor_name || "",
      "Transaction Type": t.transaction_type,
      Amount: t.amount,
      "Transaction Date": t.transaction_date,
      Remarks: t.remarks || "",
      "RM Email": t.rm_email || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deposits_Withdrawals");
    XLSX.writeFile(
      wb,
      `deposits_withdrawals_${format(new Date(), "yyyy-MM-dd")}.xlsx`
    );
    toast.success("Export complete");
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  // Calculate summary
  const summary = transactions.reduce(
    (acc, t) => {
      if (t.transaction_type.toLowerCase().includes("deposit")) {
        acc.deposits += t.amount;
      } else {
        acc.withdrawals += t.amount;
      }
      return acc;
    },
    { deposits: 0, withdrawals: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>Deposits & Withdrawals</CardTitle>
          <div className="flex flex-wrap gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              size="sm"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Import Excel
            </Button>
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Transactions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all deposit/withdrawal records.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAll}>
                    Delete All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by investor code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Deposit">Deposits</SelectItem>
              <SelectItem value="Withdrawal">Withdrawals</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Total Records</p>
            <p className="text-lg font-semibold">{totalCount.toLocaleString()}</p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Deposits (page)</p>
            <p className="text-lg font-semibold text-green-600">
              {formatCurrency(summary.deposits)}
            </p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Withdrawals (page)</p>
            <p className="text-lg font-semibold text-red-600">
              {formatCurrency(summary.withdrawals)}
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Net (page)</p>
            <p className="text-lg font-semibold">
              {formatCurrency(summary.deposits - summary.withdrawals)}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-md overflow-hidden">
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Investor Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>RM Email</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No transactions found
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">
                        {t.investor_code}
                      </TableCell>
                      <TableCell>{t.investor_name || "-"}</TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            t.transaction_type.toLowerCase().includes("deposit")
                              ? "bg-green-500/20 text-green-700"
                              : "bg-red-500/20 text-red-700"
                          }`}
                        >
                          {t.transaction_type}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell>{t.transaction_date}</TableCell>
                      <TableCell className="text-xs">
                        {t.rm_email || "-"}
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate"
                        title={t.remarks || ""}
                      >
                        {t.remarks || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {currentPage + 1} of {totalPages || 1}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(0)}
                disabled={currentPage === 0}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => p - 1)}
                disabled={currentPage === 0}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={currentPage >= totalPages - 1}
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages - 1)}
                disabled={currentPage >= totalPages - 1}
              >
                Last
              </Button>
            </div>
          </div>
        </div>

        {/* Import instructions */}
        <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
          <p className="font-medium mb-1">Excel Import Format:</p>
          <p>
            Required columns: <code>Investor Code</code>,{" "}
            <code>Transaction Type</code> (Deposit/Withdrawal), <code>Amount</code>
          </p>
          <p>
            Optional columns: <code>Investor Name</code>,{" "}
            <code>Transaction Date</code>, <code>RM Email</code>,{" "}
            <code>Remarks</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
