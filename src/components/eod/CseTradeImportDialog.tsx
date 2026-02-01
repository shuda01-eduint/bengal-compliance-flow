import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, Loader2, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface CseTradeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate?: Date;
  onImportComplete?: () => void;
}

type ImportStep = "upload" | "importing" | "complete" | "error";

export function CseTradeImportDialog({
  open,
  onOpenChange,
  selectedDate,
  onImportComplete,
}: CseTradeImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    trade_count?: number;
    gross_buy?: number;
    gross_sell?: number;
    error?: string;
  } | null>(null);

  const resetState = () => {
    setStep("upload");
    setFile(null);
    setReplaceExisting(false);
    setImporting(false);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith(".txt")) {
      toast.error("Invalid file type", {
        description: "Please upload a .txt file for CSE trades",
      });
      return;
    }

    setFile(selectedFile);
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    const tradeDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

    setImporting(true);
    setStep("importing");

    try {
      const content = await file.text();

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-cse-trades`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            trade_date: tradeDate,
            txt_content: content,
            replace_existing: replaceExisting,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Import failed");
      }

      setResult(data);
      setStep("complete");
      toast.success("CSE trades imported", {
        description: `${data.trade_count?.toLocaleString()} trades imported for ${tradeDate}`,
      });
      onImportComplete?.();

    } catch (error: any) {
      console.error("Import error:", error);
      setResult({ error: error.message });
      setStep("error");
      toast.error("Import failed", { description: error.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import CSE Trades</DialogTitle>
          <DialogDescription>
            Upload a CSE pipe-delimited TXT file
            {selectedDate && (
              <span className="block mt-1 font-medium text-foreground">
                Trade Date: {format(selectedDate, "MMM d, yyyy")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-6 w-6 text-primary" />
                  <span className="font-medium">{file.name}</span>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="font-medium">Click to upload TXT file</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    CSE pipe-delimited format
                  </p>
                </>
              )}
              <Input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".txt"
                className="hidden"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="replace-cse"
                checked={replaceExisting}
                onCheckedChange={(checked) => setReplaceExisting(checked === true)}
              />
              <Label htmlFor="replace-cse" className="text-sm">
                Replace existing CSE data for this date
              </Label>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
            <p className="font-medium">Importing CSE trades...</p>
            <p className="text-sm text-muted-foreground mt-1">
              This may take a moment for large files
            </p>
          </div>
        )}

        {step === "complete" && result && (
          <div className="py-6 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <p className="font-medium text-lg">Import Complete</p>
            <div className="mt-4 space-y-2 text-sm">
              <p>Trades imported: <span className="font-bold">{result.trade_count?.toLocaleString()}</span></p>
              <p>Gross Buy: <span className="font-bold text-green-600">৳{result.gross_buy?.toLocaleString()}</span></p>
              <p>Gross Sell: <span className="font-bold text-red-600">৳{result.gross_sell?.toLocaleString()}</span></p>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="py-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="font-medium text-lg">Import Failed</p>
            <p className="text-sm text-muted-foreground mt-2">{result?.error}</p>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Import CSE Trades
              </Button>
            </>
          )}
          {(step === "complete" || step === "error") && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
