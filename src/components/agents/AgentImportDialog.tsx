import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ParsedAgent {
  agent_id: string;
  name: string;
  commission_rate: number | null;
  bank_account: string | null;
  routing_number: string | null;
  bank_name: string | null;
  tin_number: string | null;
  nid_number: string | null;
  rm_id: string;
  rm_name: string | null;
  status: string | null;
  remarks: string | null;
}

export function AgentImportDialog() {
  const [open, setOpen] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedAgent[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [clearExisting, setClearExisting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const parseCommissionRate = (value: any): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const str = String(value).replace("%", "").trim();
    const num = parseFloat(str);
    if (isNaN(num)) return null;
    // If value is like "0.25%" or "25%", convert appropriately
    return num > 1 ? num / 100 : num;
  };

  const cleanString = (value: any): string | null => {
    if (value === null || value === undefined || value === "") return null;
    return String(value).trim();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      const agents: ParsedAgent[] = jsonData
        .map((row: any) => {
          // Try multiple column name variations
          const agentId = cleanString(row["Agent ID"] || row["agent_id"] || row["AgentID"]);
          const rmId = cleanString(row["RM ID"] || row["rm_id"] || row["RMID"]);
          const name = cleanString(row["Name"] || row["name"] || row["Agent Name"]);

          if (!agentId || !rmId || !name) return null;

          return {
            agent_id: agentId,
            name: name,
            commission_rate: parseCommissionRate(row["Cut off"] || row["Commission"] || row["commission_rate"]),
            bank_account: cleanString(row["Bank Acc."] || row["Bank Account"] || row["bank_account"]),
            routing_number: cleanString(row["Routing No."] || row["Routing Number"] || row["routing_number"]),
            bank_name: cleanString(row["Bank Name"] || row["bank_name"]),
            tin_number: cleanString(row["TIN"] || row["tin_number"] || row["TIN Number"]),
            nid_number: cleanString(row["NID"] || row["nid_number"] || row["NID Number"]),
            rm_id: rmId,
            rm_name: cleanString(row["RM Name"] || row["rm_name"]),
            status: cleanString(row["Status"] || row["status"]) || "Active",
            remarks: cleanString(row["Remarks"] || row["remarks"]),
          };
        })
        .filter((a): a is ParsedAgent => a !== null);

      setParsedData(agents);

      if (agents.length === 0) {
        toast({
          title: "No valid data found",
          description: "Please check your Excel file format. Required columns: Agent ID, Name, RM ID",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error parsing file:", error);
      toast({
        title: "Error parsing file",
        description: "Please ensure the file is a valid Excel file",
        variant: "destructive",
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;

    setIsUploading(true);

    try {
      if (clearExisting) {
        const { error: deleteError } = await supabase.from("agents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (deleteError) throw deleteError;
      }

      // Upsert in batches of 100
      const batchSize = 100;
      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = parsedData.slice(i, i + batchSize);
        const { error } = await supabase.from("agents").upsert(batch, {
          onConflict: "agent_id",
          ignoreDuplicates: false,
        });
        if (error) throw error;
      }

      toast({
        title: "Import successful",
        description: `${parsedData.length} agents imported successfully`,
      });

      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setOpen(false);
      setParsedData([]);
      setFileName(null);
      setClearExisting(false);
    } catch (error: any) {
      console.error("Import error:", error);
      toast({
        title: "Import failed",
        description: error.message || "An error occurred during import",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Import Agents
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Agents from Excel</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              ref={fileInputRef}
              id="agent-file-upload"
            />
            <label htmlFor="agent-file-upload" className="cursor-pointer">
              <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {fileName ? fileName : "Click to upload Excel file"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Required columns: Agent ID, Name, RM ID
              </p>
            </label>
          </div>

          {parsedData.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{parsedData.length} agents parsed successfully</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clear-existing"
                    checked={clearExisting}
                    onCheckedChange={(checked) => setClearExisting(checked as boolean)}
                  />
                  <Label htmlFor="clear-existing" className="text-sm">
                    Clear existing agents before import
                  </Label>
                </div>
              </div>

              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>RM</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.slice(0, 50).map((agent, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{agent.agent_id}</TableCell>
                        <TableCell>{agent.name}</TableCell>
                        <TableCell>{agent.commission_rate ? `${(agent.commission_rate * 100).toFixed(2)}%` : "N/A"}</TableCell>
                        <TableCell>{agent.rm_name || agent.rm_id}</TableCell>
                        <TableCell className="truncate max-w-[150px]">{agent.bank_name || "-"}</TableCell>
                        <TableCell>{agent.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedData.length > 50 && (
                  <p className="text-center text-sm text-muted-foreground py-2">
                    ... and {parsedData.length - 50} more agents
                  </p>
                )}
              </ScrollArea>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setParsedData([]); setFileName(null); }}>
                  Cancel
                </Button>
                <Button onClick={handleImport} disabled={isUploading}>
                  {isUploading ? "Importing..." : `Import ${parsedData.length} Agents`}
                </Button>
              </div>
            </>
          )}

          {parsedData.length === 0 && (
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-md">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-1">Expected Excel columns:</p>
                <p>Agent ID, Name, Cut off (commission), Bank Acc., Routing No., Bank Name, TIN, NID, RM ID, RM Name, Status, Remarks</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
