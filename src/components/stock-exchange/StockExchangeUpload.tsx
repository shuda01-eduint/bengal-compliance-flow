import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ReconciliationResults } from "./ReconciliationResults";

interface ParsedTrade {
  inv_code: string;
  scrip: string;
  quantity: number;
  rate: number;
  value: number;
  trade_type: "BUY" | "SELL";
}

interface ReconciliationResult {
  inv_code: string;
  investor_name: string;
  rm_name: string;
  trades: ParsedTrade[];
  total_buy_value: number;
  total_sell_value: number;
  net_value: number;
  current_ledger_balance: number;
  current_equity: number;
  status: "matched" | "unmatched" | "warning";
  issues: string[];
}

export function StockExchangeUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[]>([]);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [parseStatus, setParseStatus] = useState<"idle" | "parsed" | "reconciled">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.html') && !selectedFile.name.endsWith('.htm')) {
        toast({
          title: "Invalid file type",
          description: "Please upload an HTML file from the stock exchange",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      setParseStatus("idle");
      setParsedTrades([]);
      setResults([]);
    }
  };

  const parseHtmlFile = async () => {
    if (!file) return;

    setParsing(true);
    try {
      const content = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      
      // Parse trade data from HTML tables
      const trades: ParsedTrade[] = [];
      const tables = doc.querySelectorAll('table');
      
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        rows.forEach((row, index) => {
          if (index === 0) return; // Skip header row
          
          const cells = row.querySelectorAll('td');
          if (cells.length >= 5) {
            // Try to extract trade data - adjust selectors based on actual HTML structure
            const invCode = cells[0]?.textContent?.trim() || '';
            const scrip = cells[1]?.textContent?.trim() || '';
            const quantity = parseFloat(cells[2]?.textContent?.replace(/,/g, '') || '0');
            const rate = parseFloat(cells[3]?.textContent?.replace(/,/g, '') || '0');
            const value = parseFloat(cells[4]?.textContent?.replace(/,/g, '') || '0');
            const tradeType = cells[5]?.textContent?.trim()?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
            
            if (invCode && scrip && !isNaN(quantity)) {
              trades.push({
                inv_code: invCode,
                scrip,
                quantity,
                rate,
                value: value || quantity * rate,
                trade_type: tradeType as "BUY" | "SELL",
              });
            }
          }
        });
      });

      if (trades.length === 0) {
        toast({
          title: "No trade data found",
          description: "Could not parse trade data from the HTML file. Please check the file format.",
          variant: "destructive",
        });
        setParsing(false);
        return;
      }

      setParsedTrades(trades);
      setParseStatus("parsed");
      toast({
        title: "File parsed successfully",
        description: `Found ${trades.length} trades from the file`,
      });
    } catch (error) {
      console.error('Error parsing HTML:', error);
      toast({
        title: "Parse error",
        description: "Failed to parse the HTML file",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const runReconciliation = async () => {
    if (parsedTrades.length === 0) return;

    setReconciling(true);
    try {
      // Get unique client codes from parsed trades
      const uniqueCodes = [...new Set(parsedTrades.map(t => t.inv_code))];
      
      // Fetch client data from database
      const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .in('inv_code', uniqueCodes);

      if (error) throw error;

      // Create a map for quick client lookup
      const clientMap = new Map(clients?.map(c => [c.inv_code, c]) || []);

      // Group trades by client code
      const tradesByClient = parsedTrades.reduce((acc, trade) => {
        if (!acc[trade.inv_code]) {
          acc[trade.inv_code] = [];
        }
        acc[trade.inv_code].push(trade);
        return acc;
      }, {} as Record<string, ParsedTrade[]>);

      // Generate reconciliation results
      const reconciliationResults: ReconciliationResult[] = Object.entries(tradesByClient).map(([invCode, trades]) => {
        const client = clientMap.get(invCode);
        const totalBuy = trades.filter(t => t.trade_type === 'BUY').reduce((sum, t) => sum + t.value, 0);
        const totalSell = trades.filter(t => t.trade_type === 'SELL').reduce((sum, t) => sum + t.value, 0);
        const netValue = totalSell - totalBuy;
        
        const issues: string[] = [];
        let status: "matched" | "unmatched" | "warning" = "matched";

        if (!client) {
          issues.push("Client code not found in database");
          status = "unmatched";
        } else {
          // Check for compliance issues
          if (client.ledger_balance < 0 && totalBuy > 0) {
            issues.push("Negative ledger balance with buy orders");
            status = "warning";
          }
          if (client.equity < totalBuy * 0.2) {
            issues.push("Insufficient equity margin for trades");
            status = "warning";
          }
        }

        return {
          inv_code: invCode,
          investor_name: client?.investor_name || 'Unknown',
          rm_name: client?.rm_name || 'Unknown',
          trades,
          total_buy_value: totalBuy,
          total_sell_value: totalSell,
          net_value: netValue,
          current_ledger_balance: client?.ledger_balance || 0,
          current_equity: client?.equity || 0,
          status,
          issues,
        };
      });

      setResults(reconciliationResults);
      setParseStatus("reconciled");
      
      const warnings = reconciliationResults.filter(r => r.status === 'warning').length;
      const unmatched = reconciliationResults.filter(r => r.status === 'unmatched').length;
      
      toast({
        title: "Reconciliation complete",
        description: `Processed ${reconciliationResults.length} clients. ${warnings} warnings, ${unmatched} unmatched.`,
      });
    } catch (error) {
      console.error('Error during reconciliation:', error);
      toast({
        title: "Reconciliation error",
        description: "Failed to reconcile data with client records",
        variant: "destructive",
      });
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Stock Exchange File
          </CardTitle>
          <CardDescription>
            Upload the daily HTML file from DSE or CSE to perform compliance checks and balance reconciliation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm"
              onChange={handleFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  Click to upload or drag and drop
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  HTML files only
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              onClick={parseHtmlFile}
              disabled={!file || parsing}
              className="btn-gradient-gold text-primary-foreground"
            >
              {parsing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Parse File
                </>
              )}
            </Button>
            
            <Button
              onClick={runReconciliation}
              disabled={parseStatus !== "parsed" || reconciling}
              variant="outline"
            >
              {reconciling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reconciling...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Run Reconciliation
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Parse Status */}
      {parseStatus === "parsed" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5" />
              Parsed {parsedTrades.length} Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="text-2xl font-bold">{parsedTrades.length}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Buy Orders</p>
                <p className="text-2xl font-bold text-green-500">
                  {parsedTrades.filter(t => t.trade_type === 'BUY').length}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Sell Orders</p>
                <p className="text-2xl font-bold text-red-500">
                  {parsedTrades.filter(t => t.trade_type === 'SELL').length}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Unique Clients</p>
                <p className="text-2xl font-bold">
                  {new Set(parsedTrades.map(t => t.inv_code)).size}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation Results */}
      {parseStatus === "reconciled" && results.length > 0 && (
        <ReconciliationResults results={results} />
      )}
    </div>
  );
}
