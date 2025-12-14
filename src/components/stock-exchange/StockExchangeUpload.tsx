import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ReconciliationResults } from "./ReconciliationResults";
import * as XLSX from "xlsx";

interface ParsedTrade {
  action: string;
  status: string;
  isin: string;
  asset_class: string;
  order_id: string;
  ref_order_id: string;
  side: "BUY" | "SELL";
  boid: string;
  security_code: string;
  board: string;
  date: string;
  time: string;
  quantity: number;
  price: number;
  value: number;
  exec_id: string;
  session: string;
  fill_type: string;
  category: string;
  compulsory_spot: string;
  client_code: string;
  trader_dealer_id: string;
  owner_dealer_id: string;
  trade_report_type: string;
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
  const [saving, setSaving] = useState(false);
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[]>([]);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [parseStatus, setParseStatus] = useState<"idle" | "parsed" | "reconciled">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const saveToDatabase = async (trades: ParsedTrade[], fileName: string) => {
    setSaving(true);
    try {
      const tradeRecords = trades.map(trade => ({
        action: trade.action,
        status: trade.status,
        isin: trade.isin,
        asset_class: trade.asset_class,
        order_id: trade.order_id,
        ref_order_id: trade.ref_order_id,
        side: trade.side,
        boid: trade.boid,
        security_code: trade.security_code,
        board: trade.board,
        trade_date: trade.date,
        trade_time: trade.time,
        quantity: trade.quantity,
        price: trade.price,
        value: trade.value,
        exec_id: trade.exec_id,
        session: trade.session,
        fill_type: trade.fill_type,
        category: trade.category,
        compulsory_spot: trade.compulsory_spot,
        client_code: trade.client_code,
        trader_dealer_id: trade.trader_dealer_id,
        owner_dealer_id: trade.owner_dealer_id,
        trade_report_type: trade.trade_report_type,
        file_name: fileName,
      }));

      const { error } = await supabase.from('trade_history').insert(tradeRecords);
      if (error) throw error;

      toast({
        title: "Trades saved",
        description: `${trades.length} trades stored for audit trail`,
      });
    } catch (error) {
      console.error('Error saving trades:', error);
      toast({
        title: "Save error",
        description: "Failed to save trades to database",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      const validExtensions = ['.html', '.htm', '.xlsx', '.xls'];
      const hasValidExt = validExtensions.some(ext => selectedFile.name.toLowerCase().endsWith(ext));
      if (!hasValidExt) {
        toast({
          title: "Invalid file type",
          description: "Please upload an HTML or Excel file from the stock exchange",
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

  const parseRowToTrade = (row: Record<string, unknown>): ParsedTrade | null => {
    const getString = (key: string) => String(row[key] ?? '').trim();
    const getNumber = (key: string) => {
      const val = row[key];
      if (typeof val === 'number') return val;
      return parseFloat(String(val ?? '0').replace(/,/g, '')) || 0;
    };

    const sideRaw = getString('Side').toUpperCase();
    const side: "BUY" | "SELL" = sideRaw === 'S' ? 'SELL' : 'BUY';
    const clientCode = getString('ClientCode');
    const securityCode = getString('SecurityCode');

    if (!clientCode || !securityCode) return null;

    return {
      action: getString('Action'),
      status: getString('Status'),
      isin: getString('ISIN'),
      asset_class: getString('AssetClass'),
      order_id: getString('OrderID'),
      ref_order_id: getString('RefOrderID'),
      side,
      boid: getString('BOID'),
      security_code: securityCode,
      board: getString('Board'),
      date: getString('Date'),
      time: getString('Time'),
      quantity: getNumber('Quantity'),
      price: getNumber('Price'),
      value: getNumber('Value') || getNumber('Quantity') * getNumber('Price'),
      exec_id: getString('ExecID'),
      session: getString('Session'),
      fill_type: getString('FillType'),
      category: getString('Category'),
      compulsory_spot: getString('CompulsorySpot'),
      client_code: clientCode,
      trader_dealer_id: getString('TraderDealerID'),
      owner_dealer_id: getString('OwnerDealerID'),
      trade_report_type: getString('TradeReportType'),
    };
  };

  const parseExcelFile = async (): Promise<ParsedTrade[]> => {
    if (!file) return [];
    
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
    
    const trades: ParsedTrade[] = [];
    for (const row of jsonData) {
      const trade = parseRowToTrade(row);
      if (trade) trades.push(trade);
    }
    return trades;
  };

  const parseHtmlFile = async (): Promise<ParsedTrade[]> => {
    if (!file) return [];
    
    const content = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    
    const trades: ParsedTrade[] = [];
    const tables = doc.querySelectorAll('table');
    
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr');
      const headers: string[] = [];
      
      rows.forEach((row, index) => {
        const cells = row.querySelectorAll('th, td');
        if (index === 0) {
          cells.forEach(cell => headers.push(cell.textContent?.trim() || ''));
          return;
        }
        
        if (cells.length >= 20) {
          const rowObj: Record<string, unknown> = {};
          cells.forEach((cell, i) => {
            if (headers[i]) {
              rowObj[headers[i]] = cell.textContent?.trim() || '';
            }
          });
          const trade = parseRowToTrade(rowObj);
          if (trade) trades.push(trade);
        }
      });
    });
    return trades;
  };

  const handleParseFile = async () => {
    if (!file) return;

    setParsing(true);
    try {
      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const trades = isExcel ? await parseExcelFile() : await parseHtmlFile();

      if (trades.length === 0) {
        toast({
          title: "No trade data found",
          description: "Could not parse trade data from the file. Please check the file format.",
          variant: "destructive",
        });
        setParsing(false);
        return;
      }

      setParsedTrades(trades);
      setParseStatus("parsed");
      
      // Save trades to database for audit trail
      await saveToDatabase(trades, file.name);
      
      toast({
        title: "File parsed successfully",
        description: `Found ${trades.length} trades from the file`,
      });
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        title: "Parse error",
        description: "Failed to parse the file",
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
      const uniqueCodes = [...new Set(parsedTrades.map(t => t.client_code))];
      
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
        if (!acc[trade.client_code]) {
          acc[trade.client_code] = [];
        }
        acc[trade.client_code].push(trade);
        return acc;
      }, {} as Record<string, ParsedTrade[]>);

      // Generate reconciliation results
      const reconciliationResults: ReconciliationResult[] = Object.entries(tradesByClient).map(([clientCode, trades]) => {
        const client = clientMap.get(clientCode);
        const totalBuy = trades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0);
        const totalSell = trades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0);
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
          inv_code: clientCode,
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
            Upload the daily HTML or Excel file from DSE or CSE to perform compliance checks and balance reconciliation
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
              accept=".html,.htm,.xlsx,.xls"
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
                  HTML or Excel files
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleParseFile}
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
                  {parsedTrades.filter(t => t.side === 'BUY').length}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Sell Orders</p>
                <p className="text-2xl font-bold text-red-500">
                  {parsedTrades.filter(t => t.side === 'SELL').length}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Unique Clients</p>
                <p className="text-2xl font-bold">
                  {new Set(parsedTrades.map(t => t.client_code)).size}
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
