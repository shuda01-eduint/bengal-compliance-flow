import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Search, Download, Upload, Users, UserCheck, Building } from "lucide-react";
import { ImportInvestorsDialog } from "./ImportInvestorsDialog";
import { InvestorDetailDialog } from "./InvestorDetailDialog";
import * as XLSX from "xlsx";
import { toast } from "sonner";

const PAGE_SIZE = 50;

type Investor = {
  id: string;
  investor_code: string;
  investor_name: string;
  investor_type: string | null;
  bo_id: string | null;
  father_spouse_name: string | null;
  mother_name: string | null;
  home_address: string | null;
  date_of_birth: string | null;
  cell_no: string | null;
  email: string | null;
  account_open_date: string | null;
  bank_account_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  status: string | null;
  trader: string | null;
  account_type: string | null;
  interest_rate: number | null;
  brokerage_commission: number | null;
};

export function InvestorsTable() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [investorTypeFilter, setInvestorTypeFilter] = useState<string>("all");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedInvestor, setSelectedInvestor] = useState<Investor | null>(null);

  // Fetch investors with filters
  const { data: investorsData, isLoading, refetch } = useQuery({
    queryKey: ["investors", search, statusFilter, investorTypeFilter, accountTypeFilter, currentPage],
    queryFn: async () => {
      let query = supabase
        .from("investors")
        .select("*", { count: "exact" });

      // Apply search filter
      if (search) {
        query = query.or(`investor_code.eq.${search},investor_name.ilike.%${search}%,bo_id.ilike.%${search}%,cell_no.ilike.%${search}%`);
      }

      // Apply status filter
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      // Apply investor type filter
      if (investorTypeFilter !== "all") {
        query = query.eq("investor_type", investorTypeFilter);
      }

      // Apply account type filter
      if (accountTypeFilter !== "all") {
        query = query.eq("account_type", accountTypeFilter);
      }

      // Apply pagination
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await query
        .order("investor_code", { ascending: true })
        .range(from, to);

      if (error) throw error;
      return { investors: data as Investor[], totalCount: count || 0 };
    },
  });

  // Fetch filter options
  const { data: filterOptions } = useQuery({
    queryKey: ["investor-filter-options"],
    queryFn: async () => {
      const [statusResult, typeResult, accountTypeResult] = await Promise.all([
        supabase.from("investors").select("status").not("status", "is", null),
        supabase.from("investors").select("investor_type").not("investor_type", "is", null),
        supabase.from("investors").select("account_type").not("account_type", "is", null),
      ]);

      const statuses = [...new Set(statusResult.data?.map((r) => r.status).filter(Boolean))];
      const types = [...new Set(typeResult.data?.map((r) => r.investor_type).filter(Boolean))];
      const accountTypes = [...new Set(accountTypeResult.data?.map((r) => r.account_type).filter(Boolean))];

      return { statuses, types, accountTypes };
    },
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ["investor-stats"],
    queryFn: async () => {
      const { count: total } = await supabase.from("investors").select("*", { count: "exact", head: true });
      const { count: active } = await supabase.from("investors").select("*", { count: "exact", head: true }).eq("status", "Active");
      return { total: total || 0, active: active || 0 };
    },
  });

  const totalPages = Math.ceil((investorsData?.totalCount || 0) / PAGE_SIZE);

  const handleExport = async () => {
    try {
      let query = supabase.from("investors").select("*");
      
      if (search) {
        query = query.or(`investor_code.eq.${search},investor_name.ilike.%${search}%`);
      }
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (investorTypeFilter !== "all") {
        query = query.eq("investor_type", investorTypeFilter);
      }
      if (accountTypeFilter !== "all") {
        query = query.eq("account_type", accountTypeFilter);
      }

      const { data, error } = await query.order("investor_code");
      if (error) throw error;

      const exportData = data.map((inv, idx) => ({
        "SL": idx + 1,
        "Code No": inv.investor_code,
        "Name": inv.investor_name,
        "Investor Type": inv.investor_type,
        "BO ID": inv.bo_id,
        "Father / Spouse Name": inv.father_spouse_name,
        "Mother Name": inv.mother_name,
        "Home Address": inv.home_address,
        "DOB": inv.date_of_birth,
        "Cell No.": inv.cell_no,
        "Email": inv.email,
        "A/C Open Date": inv.account_open_date,
        "Bank A/C No.": inv.bank_account_no,
        "Bank": inv.bank_name,
        "Branch": inv.bank_branch,
        "Status": inv.status,
        "Trader": inv.trader,
        "Account Type": inv.account_type,
        "Interest Rate": inv.interest_rate,
        "Brokerage Commission": inv.brokerage_commission,
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Investors");
      XLSX.writeFile(wb, `Investors_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success("Export completed");
    } catch (error) {
      toast.error("Export failed");
      console.error(error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Investors</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Investors</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{stats?.active.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Types</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filterOptions?.accountTypes?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card className="glass-card">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by code, name, BO ID, phone..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-10"
                />
              </div>

              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {filterOptions?.statuses?.map((s) => (
                    <SelectItem key={s} value={s!}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={investorTypeFilter} onValueChange={(v) => { setInvestorTypeFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {filterOptions?.types?.map((t) => (
                    <SelectItem key={t} value={t!}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={accountTypeFilter} onValueChange={(v) => { setAccountTypeFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Account Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {filterOptions?.accountTypes?.map((a) => (
                    <SelectItem key={a} value={a!}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
              <Button onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Code No</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>BO ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cell No.</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead>Account Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : investorsData?.investors?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No investors found
                    </TableCell>
                  </TableRow>
                ) : (
                  investorsData?.investors?.map((investor) => (
                    <TableRow
                      key={investor.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedInvestor(investor)}
                    >
                      <TableCell className="font-medium">{investor.investor_code}</TableCell>
                      <TableCell>{investor.investor_name}</TableCell>
                      <TableCell>{investor.bo_id || "-"}</TableCell>
                      <TableCell>{investor.investor_type || "-"}</TableCell>
                      <TableCell>{investor.cell_no || "-"}</TableCell>
                      <TableCell>{investor.trader || "-"}</TableCell>
                      <TableCell>{investor.account_type || "-"}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          investor.status === "Active" 
                            ? "bg-green-500/10 text-green-500" 
                            : "bg-red-500/10 text-red-500"
                        }`}>
                          {investor.status || "Unknown"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t p-4">
              <p className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * PAGE_SIZE) + 1} to{" "}
                {Math.min(currentPage * PAGE_SIZE, investorsData?.totalCount || 0)} of{" "}
                {investorsData?.totalCount || 0} investors
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <PaginationItem key={pageNum}>
                        <PaginationLink
                          onClick={() => setCurrentPage(pageNum)}
                          isActive={currentPage === pageNum}
                          className="cursor-pointer"
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <ImportInvestorsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={() => refetch()}
      />

      <InvestorDetailDialog
        investor={selectedInvestor}
        onClose={() => setSelectedInvestor(null)}
      />
    </div>
  );
}
