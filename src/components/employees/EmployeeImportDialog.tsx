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

interface ImportedEmployee {
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  branch: string;
  joining_date: string;
  email: string;
  status: string;
  manager: string | null;
  bank_account: string | null;
  serial_number: number | null;
  date_of_confirmation: string | null;
  date_of_promotion: string | null;
  date_of_birth: string | null;
  service_year: number | null;
  service_month: number | null;
  service_date: number | null;
  increment_date: string | null;
  release_date: string | null;
  performance_2019: string | null;
  performance_2020: string | null;
  religion: string | null;
  employment_category: string | null;
  marital_status: string | null;
  upay_number: string | null;
  personal_phone: string | null;
  corporate_phone: string | null;
  nid_number: string | null;
  father_name: string | null;
  mother_name: string | null;
  spouse_name: string | null;
  blood_group: string | null;
  old_email: string | null;
  tin_number: string | null;
  functional_designation: string | null;
  category: string | null;
  gender: string | null;
  nationality: string | null;
  present_address: string | null;
  permanent_address: string | null;
  passport_number: string | null;
  highest_degree: string | null;
  employment_status: string | null;
}

export const EmployeeImportDialog = () => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ImportedEmployee[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const queryClient = useQueryClient();

  const parseString = (val: any): string | null => {
    if (val === null || val === undefined || val === "" || val === "N/A") return null;
    return String(val).trim();
  };

  const parseNumber = (val: any): number | null => {
    if (val === null || val === undefined || val === "" || val === "N/A") return null;
    const num = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
    return isNaN(num) ? null : num;
  };

  const parseDate = (val: any): string | null => {
    if (val === null || val === undefined || val === "" || val === "N/A") return null;
    
    // Handle Excel serial dates
    if (typeof val === "number") {
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toISOString().split("T")[0];
    }
    
    // Handle string dates
    const dateStr = String(val).trim();
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
    
    return null;
  };

  const getColumnValue = (row: any, ...possibleNames: string[]): any => {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
        return row[name];
      }
    }
    return null;
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
      
      const sheetName = workbook.SheetNames.find(name => 
        name.toLowerCase().includes('employee') || 
        name.toLowerCase().includes('staff') ||
        name.toLowerCase().includes('list')
      ) || workbook.SheetNames[0];
      
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      const employees: ImportedEmployee[] = jsonData.map((row: any) => {
        const employeeId = getColumnValue(row, "ID NO", "Employee ID", "Emp ID", "ID", "employee_id", "Emp: ID");
        const name = getColumnValue(row, "Name", "Employee Name", "Full Name", "name", "NAME");
        const designation = getColumnValue(row, "Designation", "Position", "Title", "designation", "DESIGNATION");
        const department = getColumnValue(row, "Dept.", "Department", "Dept", "department", "DEPARTMENT");
        const branch = getColumnValue(row, "Branch", "Location", "Office", "branch", "BRANCH");
        const joiningDate = getColumnValue(row, "DOJ", "Date of Joining", "Joining Date", "joining_date", "Join Date");
        const email = getColumnValue(row, "E-mail", "Email", "email", "EMAIL", "Corporate Email");
        const status = getColumnValue(row, "Status", "Employment Status", "status", "STATUS") || "Active";

        return {
          employee_id: String(employeeId || "").trim(),
          name: parseString(name) || "",
          designation: parseString(designation) || "",
          department: parseString(department) || "",
          branch: parseString(branch) || "",
          joining_date: parseDate(joiningDate) || new Date().toISOString().split("T")[0],
          email: parseString(email) || "",
          status: parseString(status) || "Active",
          manager: parseString(getColumnValue(row, "Manager", "Reporting To", "Reports To", "manager")),
          bank_account: parseString(getColumnValue(row, "SB-A/C- NO.", "Bank Account", "Bank A/C", "bank_account")),
          serial_number: parseNumber(getColumnValue(row, "SL", "Sl.", "Serial", "serial_number")),
          date_of_confirmation: parseDate(getColumnValue(row, "Date of Confirmation", "Confirmation Date", "DOC")),
          date_of_promotion: parseDate(getColumnValue(row, "Date of Promotion", "Promotion Date")),
          date_of_birth: parseDate(getColumnValue(row, "DOB", "Date of Birth", "Birth Date")),
          service_year: parseNumber(getColumnValue(row, "Service Year", "Years", "Year")),
          service_month: parseNumber(getColumnValue(row, "Service Month", "Month")),
          service_date: parseNumber(getColumnValue(row, "Service Date", "Date")),
          increment_date: parseDate(getColumnValue(row, "Increment Date", "Next Increment")),
          release_date: parseDate(getColumnValue(row, "Release Date", "Termination Date", "End Date")),
          performance_2019: parseString(getColumnValue(row, "Performance 2019", "2019 Rating", "Rating 2019")),
          performance_2020: parseString(getColumnValue(row, "Performance 2020", "2020 Rating", "Rating 2020")),
          religion: parseString(getColumnValue(row, "Religion", "religion")),
          employment_category: parseString(getColumnValue(row, "Employment Category", "Category", "Emp Category")),
          marital_status: parseString(getColumnValue(row, "Marital Status", "Marital")),
          upay_number: parseString(getColumnValue(row, "Upay A/C", "Upay Number", "Upay")),
          personal_phone: parseString(getColumnValue(row, "Personal Phone", "Personal Mobile", "Mobile")),
          corporate_phone: parseString(getColumnValue(row, "Corporate Phone", "Office Phone", "Phone")),
          nid_number: parseString(getColumnValue(row, "NID", "NID Number", "National ID")),
          father_name: parseString(getColumnValue(row, "Father's Name", "Father Name", "Father")),
          mother_name: parseString(getColumnValue(row, "Mother's Name", "Mother Name", "Mother")),
          spouse_name: parseString(getColumnValue(row, "Spouse Name", "Spouse")),
          blood_group: parseString(getColumnValue(row, "Blood Group", "Blood")),
          old_email: parseString(getColumnValue(row, "Old Email", "Previous Email")),
          tin_number: parseString(getColumnValue(row, "TIN", "TIN Number", "Tax ID")),
          functional_designation: parseString(getColumnValue(row, "Functional Designation", "Functional Title")),
          category: parseString(getColumnValue(row, "Category", "Job Category")),
          gender: parseString(getColumnValue(row, "Gender", "Sex")),
          nationality: parseString(getColumnValue(row, "Nationality", "Country")) || "Bangladeshi",
          present_address: parseString(getColumnValue(row, "Present Address", "Current Address")),
          permanent_address: parseString(getColumnValue(row, "Permanent Address", "Home Address")),
          passport_number: parseString(getColumnValue(row, "Passport", "Passport Number", "Passport No")),
          highest_degree: parseString(getColumnValue(row, "Highest Degree", "Education", "Qualification")),
          employment_status: parseString(getColumnValue(row, "Employment Status", "Emp Status")),
        };
      }).filter(emp => {
        const id = emp.employee_id;
        return id && 
               id !== "SL" && 
               id !== "#" && 
               id !== "Sl." &&
               !id.toLowerCase().includes('total') &&
               emp.name;
      });

      if (employees.length === 0) {
        setParseError("No valid employee data found. Please check your file format.");
        return;
      }

      setParsedData(employees);
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
          .from("employees")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (deleteError) throw deleteError;
      }

      setImportProgress(30);

      const batchSize = 50;
      let inserted = 0;
      const errors: string[] = [];

      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize);

        const { error } = await supabase.from("employees").upsert(batch, {
          onConflict: "employee_id",
          ignoreDuplicates: false,
        });
        
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
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast({
        title: "Import Successful",
        description: `Imported ${data.inserted} of ${data.total} employee records.`,
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
          Import Employees
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Employee Data</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file to bulk import employee records.
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
              id="employee-import-file"
            />
            <label
              htmlFor="employee-import-file"
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
                <span>Found {parsedData.length} employee records ready to import</span>
              </div>

              <div className="max-h-40 overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">ID</th>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-left">Designation</th>
                      <th className="px-2 py-1 text-left">Dept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedData.slice(0, 10).map((emp, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{emp.employee_id}</td>
                        <td className="px-2 py-1">{emp.name}</td>
                        <td className="px-2 py-1">{emp.designation}</td>
                        <td className="px-2 py-1">{emp.department}</td>
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
                  id="clear-existing-employees"
                  checked={clearExisting}
                  onCheckedChange={(checked) => setClearExisting(checked === true)}
                />
                <label
                  htmlFor="clear-existing-employees"
                  className="text-sm font-medium leading-none"
                >
                  Replace all existing employee data
                </label>
              </div>
            </div>
          )}

          {importMutation.isPending && (
            <div className="space-y-2">
              <Progress value={importProgress} />
              <p className="text-sm text-center text-muted-foreground">
                Importing employee data...
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
