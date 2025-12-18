import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ReconciliationResults } from "./ReconciliationResults";
import * as XLSX from "xlsx";
import { TradeRecordSchema, sanitizeString } from "@/lib/validation-schemas";
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
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const saveToDatabase = async (trades: ParsedTrade[], fileName: string) => {
    setSaving(true);
    setProgress({ current: 0, total: trades.length });
    
    try {
      // Get unique client codes to fetch investor/client data for denormalization
      const clientCodes = [...new Set(trades.map(t => t.client_code).filter(Boolean))];
      
      // Fetch investor, client, agent, and deposits/withdrawals data in parallel
      const [investorsResult, clientsResult, agentCodesResult, depositsResult] = await Promise.all([
        supabase
          .from("investors")
          .select("investor_code, brokerage_commission, interest_rate, account_type, investor_type")
          .in("investor_code", clientCodes),
        supabase
          .from("clients")
          .select("inv_code, ledger_balance, rm_name")
          .in("inv_code", clientCodes),
        supabase
          .from("agent_codes")
          .select("investor_code, agent_id, rm_id")
          .in("investor_code", clientCodes),
        supabase
          .from("deposits_withdrawals")
          .select("investor_code, transaction_type, amount")
          .in("investor_code", clientCodes)
      ]);
      
      // Build lookup maps
      const investorMap: Record<string, { 
        brokerage_commission: number | null; 
        interest_rate: number | null;
        account_type: string | null;
        investor_type: string | null;
      }> = {};
      const clientMap: Record<string, { ledger_balance: number | null; rm_name: string | null }> = {};
      const agentMap: Record<string, { agent_id: string | null; rm_id: string | null }> = {};
      const depositsMap: Record<string, { total_deposits: number; total_withdrawals: number; net_deposit: number }> = {};
      
      if (investorsResult.data) {
        investorsResult.data.forEach(inv => {
          investorMap[inv.investor_code] = {
            brokerage_commission: inv.brokerage_commission,
            interest_rate: inv.interest_rate,
            account_type: inv.account_type,
            investor_type: inv.investor_type,
          };
        });
      }
      
      if (clientsResult.data) {
        clientsResult.data.forEach(client => {
          clientMap[client.inv_code] = { 
            ledger_balance: client.ledger_balance,
            rm_name: client.rm_name,
          };
        });
      }
      
      if (agentCodesResult.data) {
        agentCodesResult.data.forEach(ac => {
          agentMap[ac.investor_code] = {
            agent_id: ac.agent_id,
            rm_id: ac.rm_id,
          };
        });
      }
      
      // Aggregate deposits/withdrawals per investor
      if (depositsResult.data) {
        depositsResult.data.forEach(tx => {
          if (!depositsMap[tx.investor_code]) {
            depositsMap[tx.investor_code] = { total_deposits: 0, total_withdrawals: 0, net_deposit: 0 };
          }
          if (tx.transaction_type.toLowerCase().includes('deposit')) {
            depositsMap[tx.investor_code].total_deposits += tx.amount;
          } else {
            depositsMap[tx.investor_code].total_withdrawals += tx.amount;
          }
        });
        // Calculate net_deposit for each investor
        Object.keys(depositsMap).forEach(code => {
          depositsMap[code].net_deposit = depositsMap[code].total_deposits - depositsMap[code].total_withdrawals;
        });
      }
      
      // Fetch department info based on RM names
      const rmNames = [...new Set(clientsResult.data?.map(c => c.rm_name).filter(Boolean) || [])];
      let departmentMap: Record<string, string> = {};
      
      if (rmNames.length > 0) {
        const { data: employees } = await supabase
          .from("employees")
          .select("name, department")
          .in("name", rmNames);
        
        if (employees) {
          employees.forEach(emp => {
            if (emp.name) departmentMap[emp.name] = emp.department;
          });
        }
      }
      
      // Validate and sanitize trade records before insert
      const validRecords: any[] = [];
      const validationErrors: string[] = [];
      
      for (let i = 0; i < trades.length; i++) {
        const trade = trades[i];
        const clientCode = sanitizeString(trade.client_code);
        const investorData = clientCode ? investorMap[clientCode] : null;
        const clientData = clientCode ? clientMap[clientCode] : null;
        const agentData = clientCode ? agentMap[clientCode] : null;
        const depositData = clientCode ? depositsMap[clientCode] : null;
        const rmName = clientData?.rm_name || null;
        const department = rmName ? departmentMap[rmName] || null : null;
        
        const rawRecord = {
          action: sanitizeString(trade.action),
          status: sanitizeString(trade.status),
          isin: sanitizeString(trade.isin),
          asset_class: sanitizeString(trade.asset_class),
          order_id: sanitizeString(trade.order_id),
          ref_order_id: sanitizeString(trade.ref_order_id),
          side: trade.side,
          boid: sanitizeString(trade.boid),
          security_code: sanitizeString(trade.security_code),
          board: sanitizeString(trade.board),
          trade_date: sanitizeString(trade.date),
          trade_time: sanitizeString(trade.time),
          quantity: trade.quantity,
          price: trade.price,
          value: trade.value,
          exec_id: sanitizeString(trade.exec_id),
          session: sanitizeString(trade.session),
          fill_type: sanitizeString(trade.fill_type),
          category: sanitizeString(trade.category),
          compulsory_spot: sanitizeString(trade.compulsory_spot),
          client_code: clientCode,
          trader_dealer_id: sanitizeString(trade.trader_dealer_id),
          owner_dealer_id: sanitizeString(trade.owner_dealer_id),
          trade_report_type: sanitizeString(trade.trade_report_type),
          file_name: sanitizeString(fileName),
          // Denormalized investor/client data
          brokerage_commission: investorData?.brokerage_commission ?? null,
          interest_rate: investorData?.interest_rate ?? null,
          account_type: investorData?.account_type ?? null,
          investor_type: investorData?.investor_type ?? null,
          ledger_balance_snapshot: clientData?.ledger_balance ?? null,
          // Denormalized agent/RM data
          agent_id: agentData?.agent_id ?? null,
          rm_id: agentData?.rm_id ?? null,
          rm_name: rmName,
          department: department,
          // Denormalized deposit/withdrawal data
          total_deposits: depositData?.total_deposits ?? 0,
          total_withdrawals: depositData?.total_withdrawals ?? 0,
          net_deposit: depositData?.net_deposit ?? 0,
        };
        
        const result = TradeRecordSchema.safeParse(rawRecord);
        if (result.success) {
          // Add all denormalized fields (not in schema but valid for insert)
          validRecords.push({
            ...result.data,
            brokerage_commission: rawRecord.brokerage_commission,
            interest_rate: rawRecord.interest_rate,
            account_type: rawRecord.account_type,
            investor_type: rawRecord.investor_type,
            ledger_balance_snapshot: rawRecord.ledger_balance_snapshot,
            agent_id: rawRecord.agent_id,
            rm_id: rawRecord.rm_id,
            rm_name: rawRecord.rm_name,
            department: rawRecord.department,
            total_deposits: rawRecord.total_deposits,
            total_withdrawals: rawRecord.total_withdrawals,
            net_deposit: rawRecord.net_deposit,
          });
        } else if (validationErrors.length < 10) {
          validationErrors.push(`Trade ${i + 1}: ${result.error.errors.map(e => e.message).join(', ')}`);
        }
      }
      
      if (validationErrors.length > 0) {
        console.warn('Trade validation warnings:', validationErrors);
      }

      // Insert in batches of 500 to avoid Supabase limits
      const batchSize = 500;
      let inserted = 0;
      
      for (let i = 0; i < validRecords.length; i += batchSize) {
        const batch = validRecords.slice(i, i + batchSize);
        // Use upsert to handle re-uploads - update existing records based on exec_id and trade_date
        const { error } = await supabase.from('trade_history').upsert(batch, { 
          onConflict: 'exec_id,trade_date',
          ignoreDuplicates: false 
        });
        if (error) throw error;
        
        inserted += batch.length;
        setProgress({ current: inserted, total: validRecords.length });
        
        // Yield to keep UI responsive
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      toast({
        title: "Trades saved",
        description: `${validRecords.length} trades stored for audit trail`,
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
      setProgress(null);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      const validExtensions = ['.html', '.htm', '.xlsx', '.xls', '.csv', '.xml', '.txt'];
      const hasValidExt = validExtensions.some(ext => selectedFile.name.toLowerCase().endsWith(ext));
      if (!hasValidExt) {
        toast({
          title: "Invalid file type",
          description: "Please upload an HTML, Excel, CSV, XML, or TXT file from the stock exchange",
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
    // Create case-insensitive getter (XML attributes may vary in case)
    const rowLower: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      rowLower[key.toLowerCase()] = row[key];
    }
    
    const getString = (key: string) => String(rowLower[key.toLowerCase()] ?? row[key] ?? '').trim();
    const getNumber = (key: string) => {
      const val = rowLower[key.toLowerCase()] ?? row[key];
      if (typeof val === 'number') return val;
      return parseFloat(String(val ?? '0').replace(/,/g, '')) || 0;
    };

    const sideRaw = getString('Side').toUpperCase();
    const side: "BUY" | "SELL" = sideRaw === 'S' ? 'SELL' : 'BUY';
    const clientCode = getString('ClientCode');
    const securityCode = getString('SecurityCode');

    if (!clientCode || !securityCode) {
      console.log('Missing required fields:', { clientCode, securityCode, row: Object.keys(row).slice(0, 5) });
      return null;
    }

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

  // Process rows in chunks to prevent UI blocking
  const processInChunks = async <T, R>(
    items: T[],
    processor: (item: T) => R | null,
    chunkSize = 500
  ): Promise<R[]> => {
    const results: R[] = [];
    const total = items.length;
    
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      for (const item of chunk) {
        const result = processor(item);
        if (result) results.push(result);
      }
      // Update progress
      setProgress({ current: Math.min(i + chunkSize, total), total });
      // Yield to the main thread to keep UI responsive
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return results;
  };

  const parseExcelFile = async (): Promise<ParsedTrade[]> => {
    if (!file) return [];
    
    setProgress({ current: 0, total: 100 }); // Initial progress
    
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
    
    console.log('Total rows to parse:', jsonData.length);
    if (jsonData.length > 0) {
      console.log('Headers:', Object.keys(jsonData[0]));
    }
    
    return processInChunks(jsonData, parseRowToTrade);
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

  // Parse pipe-delimited text file (CSE/DSE format)
  // Format: board|code|security|side|qty|price|client|?|?|exec_id|exec_date|exec_time|order_date|order_time|flag
  const parsePipeDelimitedFile = async (): Promise<ParsedTrade[]> => {
    if (!file) return [];
    
    const content = await file.text();
    const lines = content.split('\n').filter(line => line.trim());
    const trades: ParsedTrade[] = [];
    
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 11) continue;
      
      // Format: board|client_code|security_code|side|quantity|price|???|???|???|order_id|trade_date|trade_time|...
      const board = parts[0]?.trim() || '';
      const clientCode = parts[1]?.trim() || ''; // Client code is at position 1
      const securityCode = parts[2]?.trim() || '';
      const sideRaw = parts[3]?.trim().toUpperCase() || '';
      const side: "BUY" | "SELL" = sideRaw === 'S' ? 'SELL' : 'BUY';
      const quantity = parseFloat(parts[4]?.replace(/,/g, '') || '0') || 0;
      const price = parseFloat(parts[5]?.replace(/,/g, '') || '0') || 0;
      const execId = parts[9]?.trim() || '';
      const dateRaw = parts[10]?.trim() || ''; // DD/MM/YYYY
      const timeRaw = parts[11]?.trim() || '';
      
      if (!clientCode || !securityCode) continue;
      
      // Convert DD/MM/YYYY to YYYYMMDD (same format as DSE trades)
      let date = dateRaw;
      if (dateRaw.includes('/')) {
        const [day, month, year] = dateRaw.split('/');
        if (day && month && year) {
          date = `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
        }
      }
      
      trades.push({
        action: '',
        status: 'FILL',
        isin: '',
        asset_class: '',
        order_id: '',
        ref_order_id: '',
        side,
        boid: '',
        security_code: securityCode,
        board,
        date,
        time: timeRaw,
        quantity,
        price,
        value: quantity * price,
        exec_id: execId,
        session: '',
        fill_type: 'FILL',
        category: '',
        compulsory_spot: '',
        client_code: clientCode,
        trader_dealer_id: '',
        owner_dealer_id: '',
        trade_report_type: '',
      });
    }
    
    console.log('Total parsed pipe-delimited trades:', trades.length);
    return trades;
  };

  const parseXmlFile = async (): Promise<ParsedTrade[]> => {
    if (!file) return [];
    
    const content = await file.text();
    console.log('XML content preview:', content.substring(0, 500));
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    
    // Check for parsing errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error('XML Parse Error:', parseError.textContent);
      return [];
    }
    
    const trades: ParsedTrade[] = [];
    
    // Try to find rows - handle various XML formats
    // Excel XML uses Worksheet > Table > Row structure
    let rows = doc.getElementsByTagName('Row');
    console.log('Found Row elements:', rows.length);
    
    // If no rows found, try lowercase
    if (rows.length === 0) {
      rows = doc.getElementsByTagName('row');
      console.log('Found row (lowercase) elements:', rows.length);
    }
    
    if (rows.length > 0) {
      // First row is typically headers
      const headerRow = rows[0];
      const headerCells = headerRow.getElementsByTagName('Cell');
      const headers: string[] = [];
      
      for (let i = 0; i < headerCells.length; i++) {
        const cell = headerCells[i];
        // Get Data element content
        const dataEl = cell.getElementsByTagName('Data')[0];
        const value = dataEl?.textContent?.trim() || '';
        headers.push(value);
      }
      
      console.log('XML Headers found:', headers);
      
      // Process data rows (skip header row)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.getElementsByTagName('Cell');
        const rowData: Record<string, unknown> = {};
        
        let currentIndex = 0;
        for (let j = 0; j < cells.length; j++) {
          const cell = cells[j];
          
          // Handle ss:Index attribute for sparse cells (Excel skips empty cells)
          const indexAttr = cell.getAttribute('ss:Index');
          if (indexAttr) {
            currentIndex = parseInt(indexAttr) - 1; // ss:Index is 1-based
          }
          
          const dataEl = cell.getElementsByTagName('Data')[0];
          const value = dataEl?.textContent?.trim() || '';
          
          if (headers[currentIndex]) {
            rowData[headers[currentIndex]] = value;
          }
          currentIndex++;
        }
        
        if (i <= 3) {
          console.log(`Row ${i} data:`, rowData);
        }
        
        const trade = parseRowToTrade(rowData);
        if (trade) trades.push(trade);
      }
    } else {
      // Fallback: Try other common XML structures (like <Trades><Detail .../> format)
      console.log('No Row elements found, trying alternative structures...');
      console.log('Root element:', doc.documentElement.tagName);
      
      // Look for Detail elements (common stock exchange format)
      const detailElements = doc.getElementsByTagName('Detail');
      console.log('Found Detail elements:', detailElements.length);
      
      if (detailElements.length > 0) {
        for (let i = 0; i < detailElements.length; i++) {
          const element = detailElements[i];
          const rowData: Record<string, unknown> = {};
          
          // Extract all attributes as trade data
          for (let j = 0; j < element.attributes.length; j++) {
            const attr = element.attributes[j];
            rowData[attr.name] = attr.value;
          }
          
          if (i < 3) {
            console.log(`Detail ${i} attributes:`, rowData);
          }
          
          const trade = parseRowToTrade(rowData);
          if (trade) trades.push(trade);
        }
      } else {
        // Try generic Trade, Record, Item elements
        const tradeElements = doc.querySelectorAll('Trade, trade, Record, record, Item, item');
        tradeElements.forEach(element => {
          const rowData: Record<string, unknown> = {};
          
          // Get attributes
          Array.from(element.attributes).forEach(attr => {
            rowData[attr.name] = attr.value;
          });
          
          // Get child element text content
          element.childNodes.forEach(node => {
            if (node.nodeType === 1) {
              const el = node as Element;
              rowData[el.tagName] = el.textContent?.trim() || '';
            }
          });
          
          const trade = parseRowToTrade(rowData);
          if (trade) trades.push(trade);
        });
      }
    }
    
    console.log('Total parsed XML trades:', trades.length);
    return trades;
  };

  const handleParseFile = async () => {
    if (!file) return;

    setParsing(true);
    try {
      const fileName = file.name.toLowerCase();
      const isExcelOrCsv = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv');
      const isXml = fileName.endsWith('.xml');
      const isTxt = fileName.endsWith('.txt');
      const trades = isExcelOrCsv 
        ? await parseExcelFile() 
        : isXml 
          ? await parseXmlFile() 
          : isTxt 
            ? await parsePipeDelimitedFile() 
            : await parseHtmlFile();

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
            Upload the daily HTML, Excel, CSV, XML, or TXT file from DSE or CSE to perform compliance checks and balance reconciliation
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
              accept=".html,.htm,.xlsx,.xls,.csv,.xml,.txt"
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
                  HTML, Excel, CSV, XML, or TXT files
                </p>
              </div>
            )}
          </div>

          {/* Progress indicator */}
          {progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{parsing ? 'Parsing' : 'Saving'}...</span>
                <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={handleParseFile}
              disabled={!file || parsing || saving}
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
              disabled={parseStatus !== "parsed" || reconciling || saving}
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
