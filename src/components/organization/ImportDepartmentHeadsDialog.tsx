import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface ImportDepartmentHeadsDialogProps {
  onSuccess?: () => void;
}

export function ImportDepartmentHeadsDialog({ onSuccess }: ImportDepartmentHeadsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewEmails, setPreviewEmails] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      // Extract emails from first column or "email" column
      const emails: string[] = [];
      jsonData.forEach((row) => {
        const email = row.email || row.Email || row.EMAIL || 
                      row["Email Address"] || row["email address"] ||
                      Object.values(row)[0];
        if (email && typeof email === "string" && email.includes("@")) {
          emails.push(email.trim());
        }
      });

      setPreviewEmails(emails);
    } catch (error) {
      toast({
        title: "Error reading file",
        description: "Could not parse the Excel file.",
        variant: "destructive",
      });
    }
  };

  const handleImport = async () => {
    if (previewEmails.length === 0) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc("bulk_assign_department_heads", {
        head_emails: previewEmails,
      });

      if (error) throw error;

      const result = data as { updated: number; total_provided: number; not_found: string[] };
      
      toast({
        title: "Department Heads Assigned",
        description: `${result.updated} of ${result.total_provided} users assigned as department heads.${
          result.not_found?.length > 0 ? ` ${result.not_found.length} emails not found in employees.` : ""
        }`,
      });

      setOpen(false);
      setPreviewEmails([]);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Import Department Heads
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import Department Heads</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file with employee emails. Each email will be assigned as department head 
            for their department (from employee records).
          </p>

          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
              id="dept-heads-file"
            />
            <label htmlFor="dept-heads-file" className="cursor-pointer">
              <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Click to select Excel file
              </p>
            </label>
          </div>

          {previewEmails.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Found {previewEmails.length} emails:
              </p>
              <div className="max-h-40 overflow-y-auto bg-muted/50 rounded-lg p-2 text-xs font-mono">
                {previewEmails.slice(0, 10).map((email, i) => (
                  <div key={i}>{email}</div>
                ))}
                {previewEmails.length > 10 && (
                  <div className="text-muted-foreground">
                    ...and {previewEmails.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={previewEmails.length === 0 || isLoading}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign {previewEmails.length} Heads
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
