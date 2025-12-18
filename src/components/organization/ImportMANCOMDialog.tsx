import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, Loader2, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportMANCOMDialogProps {
  onSuccess?: () => void;
}

interface ManagerRecord {
  outlet_name: string;
  manager_id: string;
  manager_name: string;
  manager_email: string;
  mancom_id: string;
  mancom_name: string;
  mancom_email: string;
}

export function ImportMANCOMDialog({ onSuccess }: ImportMANCOMDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ManagerRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const findColumn = (row: Record<string, any>, patterns: string[]): string => {
    for (const pattern of patterns) {
      const key = Object.keys(row).find(k => 
        k.toLowerCase().includes(pattern.toLowerCase())
      );
      if (key && row[key]) return String(row[key]).trim();
    }
    return "";
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      const records: ManagerRecord[] = [];
      
      jsonData.forEach((row) => {
        // Map columns based on the Excel structure
        const outletName = findColumn(row, ["Outlet Name", "Branch", "outlet"]);
        const managerId = findColumn(row, ["Manager ID", "Mgr ID", "Branch Manager ID"]);
        const managerName = findColumn(row, ["Manager Name", "Branch Manager Name", "Mgr Name"]);
        const managerEmail = findColumn(row, ["Manager Email", "Branch Manager Email", "Mgr Email"]);
        const mancomId = findColumn(row, ["MANCOM ID", "Mancom ID"]);
        const mancomName = findColumn(row, ["MANCOM Name", "Mancom Name"]);
        const mancomEmail = findColumn(row, ["MANCOM Email", "Mancom Email"]);

        if (outletName && mancomEmail) {
          records.push({
            outlet_name: outletName,
            manager_id: managerId,
            manager_name: managerName,
            manager_email: managerEmail,
            mancom_id: mancomId,
            mancom_name: mancomName,
            mancom_email: mancomEmail,
          });
        }
      });

      setPreviewData(records);
      
      if (records.length === 0) {
        toast({
          title: "No valid records found",
          description: "Please ensure the Excel file has columns for Outlet Name and MANCOM Email.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error reading file",
        description: "Could not parse the Excel file.",
        variant: "destructive",
      });
    }
  };

  const handleImport = async () => {
    if (previewData.length === 0) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc("bulk_assign_mancom_managers", {
        managers: JSON.parse(JSON.stringify(previewData)),
      });

      if (error) throw error;

      const result = data as { 
        outlets_imported: number; 
        mancom_profiles_updated: number;
        unique_mancom_emails: number;
        unique_manager_emails: number;
      };
      
      toast({
        title: "MANCOM/Managers Imported",
        description: `${result.outlets_imported} outlets imported. ${result.unique_mancom_emails || 0} MANCOM members, ${result.unique_manager_emails || 0} Branch Managers identified.`,
      });

      setOpen(false);
      setPreviewData([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate unique counts for preview
  const uniqueMANCOM = new Set(previewData.map(r => r.mancom_email.toLowerCase()).filter(Boolean));
  const uniqueManagers = new Set(previewData.map(r => r.manager_email.toLowerCase()).filter(Boolean));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="h-4 w-4 mr-2" />
          Import MANCOM/Managers
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import MANCOM & Branch Managers</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file with columns: Outlet Name, Manager ID/Name/Email, MANCOM ID/Name/Email.
            This will assign MANCOM and Branch Manager roles based on the hierarchy.
          </p>

          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
              id="mancom-file"
            />
            <label htmlFor="mancom-file" className="cursor-pointer">
              <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Click to select Excel file
              </p>
            </label>
          </div>

          {previewData.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">
                  Found {previewData.length} outlets
                </span>
                <span className="text-muted-foreground">
                  • {uniqueMANCOM.size} unique MANCOM members
                </span>
                <span className="text-muted-foreground">
                  • {uniqueManagers.size} unique Branch Managers
                </span>
              </div>
              
              <ScrollArea className="h-[300px] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 bg-background">Outlet</TableHead>
                      <TableHead className="sticky top-0 bg-background">Manager</TableHead>
                      <TableHead className="sticky top-0 bg-background">Manager Email</TableHead>
                      <TableHead className="sticky top-0 bg-background">MANCOM</TableHead>
                      <TableHead className="sticky top-0 bg-background">MANCOM Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(0, 50).map((record, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{record.outlet_name}</TableCell>
                        <TableCell className="text-xs">{record.manager_name || "-"}</TableCell>
                        <TableCell className="text-xs">{record.manager_email || "-"}</TableCell>
                        <TableCell className="text-xs">{record.mancom_name || "-"}</TableCell>
                        <TableCell className="text-xs">{record.mancom_email}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewData.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    Showing first 50 of {previewData.length} records
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={previewData.length === 0 || isLoading}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import {previewData.length} Outlets
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
