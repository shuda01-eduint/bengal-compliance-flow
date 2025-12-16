import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";

interface ImportBalancesRawDialogProps {
  onImportComplete?: () => void;
}

// Column name variations for flexible mapping
const COLUMN_MAPPINGS: Record<string, string[]> = {
  investor_code: ['Investor Code', 'Inv. Code', 'Inv Code', 'Code', 'investor_code', 'InvCode'],
  instrument: ['Instrument', 'Trading Code', 'Script', 'Security', 'instrument'],
  total_stock: ['TotalStock', 'Total Stock', 'Total Qty', 'Qty', 'total_stock', 'Quantity'],
  saleable: ['Saleable', 'Saleable Qty', 'saleable', 'SaleableQty'],
  avg_cost: ['AvgCost', 'Avg Cost', 'Average Cost', 'avg_cost', 'Avg. Cost'],
  total_cost: ['Total Cost', 'TotalCost', 'Cost', 'total_cost'],
  total_mv: ['Total M.V.', 'Total MV', 'Market Value', 'M.V.', 'MV', 'total_mv', 'TotalMV'],
  ledger_balance: ['Ledger Balance', 'Ledger', 'ledger_balance', 'Balance'],
  matured_balance: ['Matured Balance', 'Matured', 'matured_balance', 'MaturedBalance'],
  receivable_sale: ['Receivable sales', 'Receivable Sale', 'receivable_sale', 'Receivables'],
  cq_in_transit: ['CQ in transit', 'CQ Transit', 'cq_in_transit', 'CQInTransit', 'CQ'],
  rm_name: ['RM', 'RM Name', 'rm_name', 'rm', 'Relationship Manager', 'Manager'],
  rm_id: ['RM ID', 'RM Id', 'rm_id', 'RMID', 'Employee ID', 'EmpID'],
};

const findColumnName = (headers: string[], targetMappings: string[]): string | null => {
  for (const mapping of targetMappings) {
    const found = headers.find(h => h.toLowerCase().trim() === mapping.toLowerCase().trim());
    if (found) return found;
  }
  return null;
};

const parseNumber = (value: any): number => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[,\s]/g, '').replace(/[()]/g, match => match === '(' ? '-' : '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

export function ImportBalancesRawDialog({ onImportComplete }: ImportBalancesRawDialogProps) {
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [asOfDate, setAsOfDate] = useState<Date>(new Date());

  const processFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setProgress(10);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (jsonData.length === 0) {
        throw new Error('No data found in file');
      }

      setProgress(20);

      // Fetch employees to build name-to-employee_id map
      const { data: employees } = await supabase
        .from('employees')
        .select('employee_id, name');
      
      const employeeMap = new Map<string, string>();
      employees?.forEach(emp => {
        // Map by name (case-insensitive, trimmed)
        const normalizedName = emp.name.toLowerCase().trim();
        employeeMap.set(normalizedName, emp.employee_id);
      });

      setProgress(30);

      const headers = Object.keys(jsonData[0] as object);
      
      // Map columns
      const columnMap: Record<string, string | null> = {};
      for (const [dbCol, variations] of Object.entries(COLUMN_MAPPINGS)) {
        columnMap[dbCol] = findColumnName(headers, variations);
      }

      // Validate required columns
      if (!columnMap.investor_code) {
        throw new Error('Required column "Investor Code" not found');
      }

      const dateStr = format(asOfDate, 'yyyy-MM-dd');
      
      // Parse rows - use rm_id from file if available, otherwise lookup by rm_name
      const records = jsonData.map((row: any) => {
        const rmName = columnMap.rm_name ? String(row[columnMap.rm_name] || '').trim() : null;
        // First try to get RM ID directly from file
        let rmId = columnMap.rm_id ? String(row[columnMap.rm_id] || '').trim() : null;
        // Handle #N/A or invalid values
        if (rmId === '#N/A' || rmId === 'N/A' || rmId === '') rmId = null;
        
        // If no direct RM ID, lookup by name from employees table
        if (!rmId && rmName) {
          const normalizedRmName = rmName.toLowerCase().trim();
          rmId = employeeMap.get(normalizedRmName) || null;
        }
        
        return {
          as_of_date: dateStr,
          investor_code: String(row[columnMap.investor_code!] || '').trim(),
          instrument: columnMap.instrument ? String(row[columnMap.instrument] || '').trim() || null : null,
          total_stock: parseNumber(columnMap.total_stock ? row[columnMap.total_stock] : 0),
          saleable: parseNumber(columnMap.saleable ? row[columnMap.saleable] : 0),
          avg_cost: parseNumber(columnMap.avg_cost ? row[columnMap.avg_cost] : 0),
          total_cost: parseNumber(columnMap.total_cost ? row[columnMap.total_cost] : 0),
          total_mv: parseNumber(columnMap.total_mv ? row[columnMap.total_mv] : 0),
          ledger_balance: parseNumber(columnMap.ledger_balance ? row[columnMap.ledger_balance] : 0),
          matured_balance: parseNumber(columnMap.matured_balance ? row[columnMap.matured_balance] : 0),
          receivable_sale: parseNumber(columnMap.receivable_sale ? row[columnMap.receivable_sale] : 0),
          cq_in_transit: parseNumber(columnMap.cq_in_transit ? row[columnMap.cq_in_transit] : 0),
          rm_name: rmName || null,
          rm_id: rmId,
        };
      }).filter(r => r.investor_code);

      if (records.length === 0) {
        throw new Error('No valid records found');
      }
      
      // Count how many RMs were matched
      const matchedRms = records.filter(r => r.rm_id).length;
      const unmatchedRms = records.filter(r => r.rm_name && !r.rm_id).length;
      console.log(`RM matching: ${matchedRms} matched, ${unmatchedRms} unmatched`);

      setProgress(50);

      // Delete existing records for this date first
      const { error: deleteError } = await supabase
        .from('balances_raw')
        .delete()
        .eq('as_of_date', dateStr);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        throw new Error(`Failed to clear existing data: ${deleteError.message}`);
      }

      setProgress(60);

      // Insert in batches
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('balances_raw')
          .insert(batch);

        if (insertError) {
          console.error('Insert error:', insertError);
          throw new Error(`Failed to insert batch: ${insertError.message}`);
        }

        inserted += batch.length;
        setProgress(60 + Math.round((inserted / records.length) * 35));

        // Yield to UI
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      setProgress(100);
      const rmInfo = columnMap.rm_name 
        ? ` (${matchedRms} RMs linked, ${unmatchedRms} unmatched)` 
        : '';
      toast.success(`Successfully imported ${records.length} balance records for ${format(asOfDate, 'PP')}${rmInfo}`);
      setOpen(false);
      onImportComplete?.();
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import file');
    } finally {
      setIsUploading(false);
      setProgress(0);
      setSelectedFile(null);
    }
  }, [asOfDate, onImportComplete]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Upload className="h-4 w-4" />
          Import Balances
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Balance Data</DialogTitle>
          <DialogDescription>
            Upload an Excel file with balance data per instrument. Existing data for the selected date will be replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>As of Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !asOfDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {asOfDate ? format(asOfDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={asOfDate}
                  onSelect={(date) => date && setAsOfDate(date)}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Select File</Label>
            <Input
              id="file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </div>

          {selectedFile && (
            <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
          )}

          {isUploading && (
            <div className="space-y-2">
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Importing... {progress}%
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || isUploading}>
              {isUploading ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
