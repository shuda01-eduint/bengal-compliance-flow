import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

interface ImportedSalary {
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

export const SalaryImportDialog = () => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ImportedSalary[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const queryClient = useQueryClient();

  const parseNumber = (val: any): number | null => {
    if (val === null || val === undefined || val === "" || val === "N/A") return null;
    const num = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
    return isNaN(num) ? null : num;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseError(null);
    setParsedData([]);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      
      let sheetName = workbook.SheetNames.find(name => 
        name.toLowerCase().includes('salary') || 
        name.toLowerCase().includes('nov') ||
        name.toLowerCase().includes('oct') ||
        name.toLowerCase().includes('sep')
      ) || workbook.SheetNames[0];
      
      const worksheet = workbook.Sheets[sheetName];
      
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      let headerRow = 0;
      
      for (let row = 0; row <= Math.min(70, range.e.r); row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
          const value = cell?.v?.toString()?.toLowerCase() || '';
          if (value.includes('id no') || value === 'id' || (value.includes('name') && value.includes('employee'))) {
            headerRow = row;
            break;
          }
        }
        if (headerRow > 0) break;
      }

      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        defval: "", 
        range: headerRow 
      });

      const salaries: ImportedSalary[] = jsonData.map((row: any) => {
        const employeeId = row["Employee ID"] || row["ID NO"] || row["Emp: ID"] || row["employee_id"] || row["ID"] || "";
        
        const basicSalary = row["Basic"] || row["Basic Salary"] || row["basic_salary"] || null;
        const houseRent = row["House Rent"] || row["H.Rent"] || row["HRA"] || row["house_rent"] || null;
        const medicalAllowance = row["Medical Allowance"] || row["Medical"] || row["medical_allowance"] || null;
        const transportAllowance = row["Conveyance Allowance"] || row["Convey."] || row["Conveyance"] || row["Transport Allowance"] || row["Transport"] || row["TA"] || row["transport_allowance"] || null;
        
        const houseMaint = parseNumber(row["House Maintenance"] || row["House Maint."] || 0);
        const entertainment = parseNumber(row["Entertainment Allowance"] || row["Entertainment"] || 0);
        const specialPay = parseNumber(row["Special Pay"] || row["Special pay"] || 0);
        const arrearSalary = parseNumber(row["Arrear Salary"] || row["Arrear"] || 0);
        const fixation = parseNumber(row["Fixation Allowance"] || 0);
        const personalPay = parseNumber(row["Personal Pay"] || 0);
        const otherAllowanceTotal = (houseMaint || 0) + (entertainment || 0) + (specialPay || 0) + (arrearSalary || 0) + (fixation || 0) + (personalPay || 0);
        
        const grossSalary = row["TOTAL"] || row["Gross Salary"] || row["Gross"] || row["gross_salary"] || null;
        
        const taxDeduction = row["IT"] || row["Tax Deduction"] || row["Tax"] || row["TDS"] || row["tax_deduction"] || null;
        const pfDeduction = row["PF"] || row["PF Deduction"] || row["Provident Fund"] || row["pf_deduction"] || null;
        
        const ewf = parseNumber(row["EWF"] || 0);
        const advanceAdj = parseNumber(row["Advance Adjustment"] || 0);
        const rs = parseNumber(row["RS"] || 0);
        const otherDeductionTotal = (ewf || 0) + (advanceAdj || 0) + (rs || 0);
        
        const netSalary = row["NET PAY"] || row["Net Salary"] || row["Net"] || row["net_salary"] || null;
        const bankAccount = row["SB-A/C- NO."] || row["Bank A/C"] || row["Bank Account"] || row["bank_account"] || null;
        const upayAccount = row["Upay A/C"] || row["Upay"] || null;
        
        let paymentMethod = "Bank Transfer";
        if (upayAccount && !bankAccount) {
          paymentMethod = "Upay";
        }

        return {
          employee_id: String(employeeId).trim(),
          basic_salary: parseNumber(basicSalary),
          house_rent: parseNumber(houseRent),
          medical_allowance: parseNumber(medicalAllowance),
          transport_allowance: parseNumber(transportAllowance),
          other_allowance: otherAllowanceTotal > 0 ? otherAllowanceTotal : null,
          gross_salary: parseNumber(grossSalary),
          tax_deduction: parseNumber(taxDeduction),
          pf_deduction: parseNumber(pfDeduction),
          other_deduction: otherDeductionTotal > 0 ? otherDeductionTotal : null,
          net_salary: parseNumber(netSalary),
          bank_account: bankAccount ? String(bankAccount).trim() : null,
          payment_method: paymentMethod,
        };
      }).filter(sal => {
        const id = sal.employee_id;
        return id && 
               id !== "SL" && 
               id !== "#" && 
               id !== "Sl." &&
               !id.toLowerCase().includes('total') &&
               !isNaN(Number(id));
      });

      if (salaries.length === 0) {
        setParseError("No valid salary data found. Please check your file format.");
        return;
      }

      setParsedData(salaries);
    } catch (error) {
      console.error("Parse error:", error);
      setParseError("Failed to parse file. Please ensure it's a valid Excel or CSV file.");
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      setImportProgress(10);

      if (clearExisting) {
        const { error: deleteError } = await supabase
          .from("employee_salaries")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (deleteError) throw deleteError;
      }

      setImportProgress(30);

      const batchSize = 50;
      let inserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize).map(sal => ({
          ...sal,
          is_current: true,
        }));

        const { error } = await supabase.from("employee_salaries").insert(batch);
        
        if (error) {
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          inserted += batch.length;
        }

        setImportProgress(30 + Math.round((i / parsedData.length) * 60));
      }

      return { inserted, total: parsedData.length, errors };
    },
    onSuccess: (data) => {
      setImportProgress(100);
      queryClient.invalidateQueries({ queryKey: ["employee-salaries"] });
      toast({
        title: "Import Successful",
        description: `Imported ${data.inserted} of ${data.total} salary records.`,
      });
      setTimeout(() => {
        setOpen(false);
        resetState();
      }, 1500);
    },
    onError: (error: Error) => {
      setImportProgress(0);
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: error.message,
      });
    },
  });

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setClearExisting(false);
    setImportProgress(0);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Import Salary Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Salary Data</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file to bulk import employee salary data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              file ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
              id="salary-import-file"
            />
            <label
              htmlFor="salary-import-file"
              className="cursor-pointer flex flex-col items-center gap-2"
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              {file ? (
                <div>
                  <p className="font-medium text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">Drop file here or click to browse</p>
                  <p className="text-sm text-muted-foreground">
                    Supports .xlsx, .xls, and .csv files
                  </p>
                </div>
              )}
            </label>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {parsedData.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Found {parsedData.length} salary records ready to import</span>
              </div>

              <div className="max-h-40 overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Emp ID</th>
                      <th className="px-2 py-1 text-right">Basic</th>
                      <th className="px-2 py-1 text-right">Gross</th>
                      <th className="px-2 py-1 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedData.slice(0, 10).map((sal, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{sal.employee_id}</td>
                        <td className="px-2 py-1 text-right">{sal.basic_salary?.toLocaleString() || "—"}</td>
                        <td className="px-2 py-1 text-right">{sal.gross_salary?.toLocaleString() || "—"}</td>
                        <td className="px-2 py-1 text-right">{sal.net_salary?.toLocaleString() || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    ... and {parsedData.length - 10} more
                  </p>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="clear-existing-salary"
                  checked={clearExisting}
                  onCheckedChange={(checked) => setClearExisting(checked === true)}
                />
                <label
                  htmlFor="clear-existing-salary"
                  className="text-sm font-medium leading-none"
                >
                  Replace all existing salary data
                </label>
              </div>
            </div>
          )}

          {importMutation.isPending && (
            <div className="space-y-2">
              <Progress value={importProgress} />
              <p className="text-sm text-center text-muted-foreground">
                Importing salary data...
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={parsedData.length === 0 || importMutation.isPending}
            >
              {importMutation.isPending ? "Importing..." : `Import ${parsedData.length} Records`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
