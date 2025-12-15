import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, DollarSign } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SalaryImportDialog } from "./SalaryImportDialog";

interface EmployeeSalary {
  id: string;
  employee_id: string;
  basic_salary: number | null;
  house_rent: number | null;
  medical_allowance: number | null;
  transport_allowance: number | null;
  other_allowance: number | null;
  gross_salary: number | null;
  tax_deduction: number | null;
  pf_deduction: number | null;
  other_deduction: number | null;
  net_salary: number | null;
  bank_account: string | null;
  payment_method: string | null;
}

const formatCurrency = (amount: number | null) => {
  if (amount === null || amount === undefined) return "—";
  return `৳${amount.toLocaleString("en-BD")}`;
};

export const SalaryTable = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: salaries = [], isLoading, error } = useQuery({
    queryKey: ["employee-salaries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_salaries")
        .select("*")
        .eq("is_current", true)
        .order("employee_id", { ascending: true });
      
      if (error) throw error;
      return data as EmployeeSalary[];
    },
  });

  const filteredSalaries = salaries.filter((sal) =>
    sal.employee_id.includes(searchQuery) ||
    sal.bank_account?.includes(searchQuery)
  );

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">Error loading salary data</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isLoading && salaries.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-2">No Salary Data Yet</h3>
          <p className="text-muted-foreground mb-4">
            Import salary data from an Excel file to get started.
          </p>
          <SalaryImportDialog />
        </div>
      )}

      {salaries.length > 0 && (
        <>
          <div className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by Employee ID or Bank Account..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-secondary/50 border-transparent focus:border-primary"
              />
            </div>
            <SalaryImportDialog />
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Emp ID</TableHead>
                    <TableHead className="font-semibold text-right">Basic</TableHead>
                    <TableHead className="font-semibold text-right">House Rent</TableHead>
                    <TableHead className="font-semibold text-right">Medical</TableHead>
                    <TableHead className="font-semibold text-right">Transport</TableHead>
                    <TableHead className="font-semibold text-right">Other Allow.</TableHead>
                    <TableHead className="font-semibold text-right">Gross</TableHead>
                    <TableHead className="font-semibold text-right">Tax</TableHead>
                    <TableHead className="font-semibold text-right">PF</TableHead>
                    <TableHead className="font-semibold text-right">Other Ded.</TableHead>
                    <TableHead className="font-semibold text-right">Net Salary</TableHead>
                    <TableHead className="font-semibold">Bank A/C</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={12}>
                          <Skeleton className="h-10 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    filteredSalaries.map((salary) => (
                      <TableRow key={salary.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-sm">#{salary.employee_id}</TableCell>
                        <TableCell className="text-right">{formatCurrency(salary.basic_salary)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(salary.house_rent)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(salary.medical_allowance)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(salary.transport_allowance)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(salary.other_allowance)}</TableCell>
                        <TableCell className="text-right font-medium text-primary">{formatCurrency(salary.gross_salary)}</TableCell>
                        <TableCell className="text-right text-destructive">{formatCurrency(salary.tax_deduction)}</TableCell>
                        <TableCell className="text-right text-destructive">{formatCurrency(salary.pf_deduction)}</TableCell>
                        <TableCell className="text-right text-destructive">{formatCurrency(salary.other_deduction)}</TableCell>
                        <TableCell className="text-right font-semibold text-green-500">{formatCurrency(salary.net_salary)}</TableCell>
                        <TableCell className="font-mono text-xs">{salary.bank_account || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredSalaries.length}</span> of{" "}
                <span className="font-medium text-foreground">{salaries.length}</span> salary records
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
