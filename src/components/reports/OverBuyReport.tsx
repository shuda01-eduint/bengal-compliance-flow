import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Search, Download, AlertTriangle, CheckCircle, RefreshCw, Plus, Settings2, Trash2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface SecurityTrade {
  security_code: string;
  category: string | null;
  buy_quantity: number;
  buy_value: number;
  sell_quantity: number;
  sell_value: number;
  net_quantity: number;
  net_value: number;
  avg_buy_price: number;
  avg_sell_price: number;
  trade_count: number;
}

interface TradeFileData {
  file_name: string;
  trade_count: number;
  buy_value: number;
  sell_value: number;
  first_trade_date: string | null;
  last_trade_date: string | null;
}

interface ClientOverBuyData {
  inv_code: string;
  investor_name: string;
  rm_name: string;
  rm_email: string | null;
  // Client balance data
  ledger_balance: number;
  market_value: number;
  equity: number;
  accrued_interest: number;
  current_liabilities: number;
  // Investor master data
  account_type: string | null;
  investor_type: string | null;
  bo_id: string | null;
  brokerage_commission: number;
  interest_rate: number;
  // Deposits/Withdrawals
  total_deposits: number;
  total_withdrawals: number;
  net_deposit: number;
  adjusted_balance: number;
  // Aggregated trade data
  net_buy: number;
  net_sell: number;
  net_position: number;
  total_buy_quantity: number;
  total_sell_quantity: number;
  trade_count: number;
  unique_securities_traded: number;
  first_trade_date: string | null;
  last_trade_date: string | null;
  // Violation
  violation_amount: number;
  is_violation: boolean;
  // Detailed data for formulas
  securities: SecurityTrade[];
  trade_files: TradeFileData[];
}

interface CustomField {
  id: string;
  name: string;
  formula: string;
  type: "number" | "boolean" | "text";
}

interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  isCustom?: boolean;
}

const STORAGE_KEY = "overbuy_report_preferences";

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "inv_code", label: "Code", visible: true },
  { key: "investor_name", label: "Investor Name", visible: true },
  { key: "rm_name", label: "RM", visible: true },
  { key: "account_type", label: "Account Type", visible: false },
  { key: "investor_type", label: "Investor Type", visible: false },
  { key: "ledger_balance", label: "Ledger Balance", visible: true },
  { key: "market_value", label: "Market Value", visible: false },
  { key: "equity", label: "Equity", visible: false },
  { key: "total_deposits", label: "Deposits", visible: true },
  { key: "total_withdrawals", label: "Withdrawals", visible: true },
  { key: "net_deposit", label: "Net Deposit", visible: true },
  { key: "adjusted_balance", label: "Adjusted Balance", visible: true },
  { key: "net_buy", label: "Net Buy", visible: true },
  { key: "net_sell", label: "Net Sell", visible: true },
  { key: "net_position", label: "Net Position", visible: true },
  { key: "trade_count", label: "Trade Count", visible: false },
  { key: "unique_securities_traded", label: "Securities Traded", visible: false },
  { key: "violation_amount", label: "Violation", visible: true },
  { key: "is_violation", label: "Status", visible: true },
];

// Safe formula evaluator with rich data access
const evaluateFormula = (formula: string, data: ClientOverBuyData): string | number | boolean => {
  try {
    // Build variables object with all available data
    const variables: Record<string, number | string | boolean> = {
      // Basic identifiers
      code: data.inv_code,
      investor_name: data.investor_name,
      rm: data.rm_name,
      
      // Client balance data
      ledger_balance: data.ledger_balance,
      market_value: data.market_value,
      equity: data.equity,
      accrued_interest: data.accrued_interest,
      current_liabilities: data.current_liabilities,
      
      // Investor master data
      account_type: data.account_type || "",
      investor_type: data.investor_type || "",
      bo_id: data.bo_id || "",
      brokerage_commission: data.brokerage_commission,
      interest_rate: data.interest_rate,
      
      // Deposits/Withdrawals
      deposits: data.total_deposits,
      withdrawals: data.total_withdrawals,
      net_deposit: data.net_deposit,
      adjusted_balance: data.adjusted_balance,
      
      // Aggregated trade data
      net_buy: data.net_buy,
      net_sell: data.net_sell,
      net_position: data.net_position,
      total_buy_qty: data.total_buy_quantity,
      total_sell_qty: data.total_sell_quantity,
      trade_count: data.trade_count,
      securities_traded: data.unique_securities_traded,
      
      // Violation
      violation_amount: data.violation_amount,
      is_violation: data.is_violation ? 1 : 0,
    };

    let result = formula;

    // Handle SECURITY_BUY(code) - get buy value for specific security
    const secBuyRegex = /SECURITY_BUY\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(secBuyRegex, (_, secCode) => {
      const sec = data.securities.find(s => s.security_code?.toLowerCase() === secCode.toLowerCase());
      return String(sec?.buy_value || 0);
    });

    // Handle SECURITY_SELL(code) - get sell value for specific security
    const secSellRegex = /SECURITY_SELL\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(secSellRegex, (_, secCode) => {
      const sec = data.securities.find(s => s.security_code?.toLowerCase() === secCode.toLowerCase());
      return String(sec?.sell_value || 0);
    });

    // Handle SECURITY_NET(code) - get net value for specific security
    const secNetRegex = /SECURITY_NET\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(secNetRegex, (_, secCode) => {
      const sec = data.securities.find(s => s.security_code?.toLowerCase() === secCode.toLowerCase());
      return String(sec?.net_value || 0);
    });

    // Handle SECURITY_QTY(code) - get net quantity for specific security
    const secQtyRegex = /SECURITY_QTY\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(secQtyRegex, (_, secCode) => {
      const sec = data.securities.find(s => s.security_code?.toLowerCase() === secCode.toLowerCase());
      return String(sec?.net_quantity || 0);
    });

    // Handle CATEGORY_BUY(category) - sum buy value for category
    const catBuyRegex = /CATEGORY_BUY\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(catBuyRegex, (_, cat) => {
      const total = data.securities
        .filter(s => s.category?.toLowerCase() === cat.toLowerCase())
        .reduce((sum, s) => sum + s.buy_value, 0);
      return String(total);
    });

    // Handle CATEGORY_SELL(category) - sum sell value for category
    const catSellRegex = /CATEGORY_SELL\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(catSellRegex, (_, cat) => {
      const total = data.securities
        .filter(s => s.category?.toLowerCase() === cat.toLowerCase())
        .reduce((sum, s) => sum + s.sell_value, 0);
      return String(total);
    });

    // Handle HAS_SECURITY(code) - check if traded specific security
    const hasSecRegex = /HAS_SECURITY\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(hasSecRegex, (_, secCode) => {
      const has = data.securities.some(s => s.security_code?.toLowerCase() === secCode.toLowerCase());
      return has ? "1" : "0";
    });

    // Handle FILE_TRADES(filename) - get trade count from specific file
    const fileTradesRegex = /FILE_TRADES\s*\(\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(fileTradesRegex, (_, fileName) => {
      const file = data.trade_files.find(f => f.file_name?.toLowerCase().includes(fileName.toLowerCase()));
      return String(file?.trade_count || 0);
    });

    // Handle CONTAINS(text, search) - check if text contains search
    const containsRegex = /CONTAINS\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*\)/gi;
    result = result.replace(containsRegex, (_, textVar, searchStr) => {
      let textVal = textVar.trim();
      Object.entries(variables).forEach(([key, val]) => {
        textVal = textVal.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
      });
      return String(textVal).toLowerCase().includes(searchStr.toLowerCase()) ? "1" : "0";
    });

    // Handle IF statements: IF(condition, trueValue, falseValue)
    const ifRegex = /IF\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi;
    result = result.replace(ifRegex, (_, condition, trueVal, falseVal) => {
      let evalCondition = condition;
      Object.entries(variables).forEach(([key, val]) => {
        evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b`, "gi"), typeof val === "string" ? `"${val}"` : String(val));
      });
      try {
        const condResult = Function(`"use strict"; return (${evalCondition})`)();
        return condResult ? trueVal.trim() : falseVal.trim();
      } catch {
        return "ERROR";
      }
    });

    // Replace variable names with values
    Object.entries(variables).forEach(([key, val]) => {
      if (typeof val === "string") {
        result = result.replace(new RegExp(`\\b${key}\\b`, "gi"), `"${val}"`);
      } else {
        result = result.replace(new RegExp(`\\b${key}\\b`, "gi"), String(val));
      }
    });

    // Support basic math functions
    result = result.replace(/ABS\s*\(/gi, "Math.abs(");
    result = result.replace(/MAX\s*\(/gi, "Math.max(");
    result = result.replace(/MIN\s*\(/gi, "Math.min(");
    result = result.replace(/ROUND\s*\(/gi, "Math.round(");

    // Evaluate the expression
    const evaluated = Function(`"use strict"; return (${result})`)();
    return evaluated;
  } catch (error) {
    console.error("Formula evaluation error:", error);
    return "ERROR";
  }
};

export function OverBuyReport() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ClientOverBuyData[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRm, setSelectedRm] = useState<string>("all");
  const [showViolationsOnly, setShowViolationsOnly] = useState(false);
  
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge saved with defaults to include new columns
      const savedKeys = new Set((parsed.columns || []).map((c: ColumnConfig) => c.key));
      const merged = [...(parsed.columns || [])];
      DEFAULT_COLUMNS.forEach(dc => {
        if (!savedKeys.has(dc.key)) {
          merged.push(dc);
        }
      });
      return merged;
    }
    return DEFAULT_COLUMNS;
  });
  
  const [customFields, setCustomFields] = useState<CustomField[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.customFields || [];
    }
    return [];
  });

  const [newFieldDialog, setNewFieldDialog] = useState(false);
  const [helpDialog, setHelpDialog] = useState(false);
  const [newField, setNewField] = useState<Partial<CustomField>>({
    name: "",
    formula: "",
    type: "number",
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, customFields }));
  }, [columns, customFields]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch clients with all balance data
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("inv_code, investor_name, rm_name, rm_email, ledger_balance, market_value, equity, accrued_interest, current_liabilities");

      if (clientsError) throw clientsError;

      // Fetch investor master data
      const { data: investors, error: investorsError } = await supabase
        .from("investors")
        .select("investor_code, account_type, investor_type, bo_id, brokerage_commission, interest_rate");

      if (investorsError) throw investorsError;

      // Fetch deposits/withdrawals
      const { data: transactions, error: txError } = await supabase
        .from("deposits_withdrawals")
        .select("investor_code, transaction_type, amount");

      if (txError) throw txError;

      // Fetch all trade history with full details
      const { data: trades, error: tradesError } = await supabase
        .from("trade_history")
        .select("client_code, side, value, quantity, price, security_code, category, trade_date, file_name");

      if (tradesError) throw tradesError;

      // Index investor data
      const investorMap = new Map(investors?.map(i => [i.investor_code, i]) || []);

      // Group deposits/withdrawals by investor_code
      const txByInvestor = new Map<string, { deposits: number; withdrawals: number }>();
      transactions?.forEach((tx) => {
        const current = txByInvestor.get(tx.investor_code) || { deposits: 0, withdrawals: 0 };
        if (tx.transaction_type === "Deposit") {
          current.deposits += Number(tx.amount) || 0;
        } else if (tx.transaction_type === "Withdrawal") {
          current.withdrawals += Number(tx.amount) || 0;
        }
        txByInvestor.set(tx.investor_code, current);
      });

      // Group trades by client with detailed breakdowns
      const tradesByClient = new Map<string, {
        buy: number;
        sell: number;
        buyQty: number;
        sellQty: number;
        count: number;
        firstDate: string | null;
        lastDate: string | null;
        securities: Map<string, { 
          category: string | null;
          buyQty: number; 
          buyVal: number; 
          sellQty: number; 
          sellVal: number;
          count: number;
        }>;
        files: Map<string, {
          count: number;
          buyVal: number;
          sellVal: number;
          firstDate: string | null;
          lastDate: string | null;
        }>;
      }>();

      trades?.forEach((trade) => {
        if (!trade.client_code) return;
        
        let clientData = tradesByClient.get(trade.client_code);
        if (!clientData) {
          clientData = {
            buy: 0,
            sell: 0,
            buyQty: 0,
            sellQty: 0,
            count: 0,
            firstDate: null,
            lastDate: null,
            securities: new Map(),
            files: new Map(),
          };
          tradesByClient.set(trade.client_code, clientData);
        }

        const value = Number(trade.value) || 0;
        const quantity = Number(trade.quantity) || 0;
        const isBuy = trade.side?.toLowerCase() === "buy";

        // Aggregate totals
        if (isBuy) {
          clientData.buy += value;
          clientData.buyQty += quantity;
        } else if (trade.side?.toLowerCase() === "sell") {
          clientData.sell += value;
          clientData.sellQty += quantity;
        }
        clientData.count++;

        // Track date range
        if (trade.trade_date) {
          if (!clientData.firstDate || trade.trade_date < clientData.firstDate) {
            clientData.firstDate = trade.trade_date;
          }
          if (!clientData.lastDate || trade.trade_date > clientData.lastDate) {
            clientData.lastDate = trade.trade_date;
          }
        }

        // Per-security breakdown
        if (trade.security_code) {
          let secData = clientData.securities.get(trade.security_code);
          if (!secData) {
            secData = { category: trade.category, buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0, count: 0 };
            clientData.securities.set(trade.security_code, secData);
          }
          if (isBuy) {
            secData.buyQty += quantity;
            secData.buyVal += value;
          } else {
            secData.sellQty += quantity;
            secData.sellVal += value;
          }
          secData.count++;
        }

        // Per-file breakdown
        if (trade.file_name) {
          let fileData = clientData.files.get(trade.file_name);
          if (!fileData) {
            fileData = { count: 0, buyVal: 0, sellVal: 0, firstDate: null, lastDate: null };
            clientData.files.set(trade.file_name, fileData);
          }
          fileData.count++;
          if (isBuy) {
            fileData.buyVal += value;
          } else {
            fileData.sellVal += value;
          }
          if (trade.trade_date) {
            if (!fileData.firstDate || trade.trade_date < fileData.firstDate) {
              fileData.firstDate = trade.trade_date;
            }
            if (!fileData.lastDate || trade.trade_date > fileData.lastDate) {
              fileData.lastDate = trade.trade_date;
            }
          }
        }
      });

      // Combine all data
      const combinedData: ClientOverBuyData[] = (clients || []).map((client) => {
        const tx = txByInvestor.get(client.inv_code) || { deposits: 0, withdrawals: 0 };
        const tradeData = tradesByClient.get(client.inv_code);
        const investor = investorMap.get(client.inv_code);
        
        const ledger_balance = Number(client.ledger_balance) || 0;
        const total_deposits = tx.deposits;
        const total_withdrawals = tx.withdrawals;
        const net_deposit = total_deposits - total_withdrawals;
        const adjusted_balance = ledger_balance + net_deposit;
        const net_buy = tradeData?.buy || 0;
        const net_sell = tradeData?.sell || 0;
        const net_position = net_buy - net_sell;
        const violation_amount = Math.max(0, net_position - adjusted_balance);
        const is_violation = net_position > adjusted_balance && adjusted_balance >= 0;

        // Build securities array
        const securities: SecurityTrade[] = [];
        tradeData?.securities.forEach((sec, code) => {
          securities.push({
            security_code: code,
            category: sec.category,
            buy_quantity: sec.buyQty,
            buy_value: sec.buyVal,
            sell_quantity: sec.sellQty,
            sell_value: sec.sellVal,
            net_quantity: sec.buyQty - sec.sellQty,
            net_value: sec.buyVal - sec.sellVal,
            avg_buy_price: sec.buyQty > 0 ? sec.buyVal / sec.buyQty : 0,
            avg_sell_price: sec.sellQty > 0 ? sec.sellVal / sec.sellQty : 0,
            trade_count: sec.count,
          });
        });

        // Build files array
        const trade_files: TradeFileData[] = [];
        tradeData?.files.forEach((file, name) => {
          trade_files.push({
            file_name: name,
            trade_count: file.count,
            buy_value: file.buyVal,
            sell_value: file.sellVal,
            first_trade_date: file.firstDate,
            last_trade_date: file.lastDate,
          });
        });

        return {
          inv_code: client.inv_code,
          investor_name: client.investor_name,
          rm_name: client.rm_name,
          rm_email: client.rm_email,
          ledger_balance,
          market_value: Number(client.market_value) || 0,
          equity: Number(client.equity) || 0,
          accrued_interest: Number(client.accrued_interest) || 0,
          current_liabilities: Number(client.current_liabilities) || 0,
          account_type: investor?.account_type || null,
          investor_type: investor?.investor_type || null,
          bo_id: investor?.bo_id || null,
          brokerage_commission: Number(investor?.brokerage_commission) || 0,
          interest_rate: Number(investor?.interest_rate) || 0,
          total_deposits,
          total_withdrawals,
          net_deposit,
          adjusted_balance,
          net_buy,
          net_sell,
          net_position,
          total_buy_quantity: tradeData?.buyQty || 0,
          total_sell_quantity: tradeData?.sellQty || 0,
          trade_count: tradeData?.count || 0,
          unique_securities_traded: tradeData?.securities.size || 0,
          first_trade_date: tradeData?.firstDate || null,
          last_trade_date: tradeData?.lastDate || null,
          violation_amount,
          is_violation,
          securities,
          trade_files,
        };
      });

      setData(combinedData);
    } catch (error) {
      console.error("Error fetching overbuy data:", error);
      toast.error("Failed to load overbuy report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const rmOptions = useMemo(() => {
    const unique = [...new Set(data.map((d) => d.rm_name).filter(Boolean))];
    return unique.sort();
  }, [data]);

  const filteredData = useMemo(() => {
    let result = data;

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.inv_code.toLowerCase().includes(searchLower) ||
          d.investor_name.toLowerCase().includes(searchLower)
      );
    }

    if (selectedRm !== "all") {
      result = result.filter((d) => d.rm_name === selectedRm);
    }

    if (showViolationsOnly) {
      result = result.filter((d) => d.is_violation);
    }

    return result;
  }, [data, search, selectedRm, showViolationsOnly]);

  const stats = useMemo(() => {
    const violations = filteredData.filter((d) => d.is_violation);
    const totalViolationAmount = violations.reduce((sum, d) => sum + d.violation_amount, 0);
    return {
      totalClients: filteredData.length,
      violationCount: violations.length,
      totalViolationAmount,
    };
  }, [filteredData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const toggleColumnVisibility = (key: string) => {
    setColumns(prev => prev.map(col => 
      col.key === key ? { ...col, visible: !col.visible } : col
    ));
  };

  const addCustomField = () => {
    if (!newField.name || !newField.formula) {
      toast.error("Please provide a name and formula");
      return;
    }

    const fieldId = `custom_${Date.now()}`;
    const field: CustomField = {
      id: fieldId,
      name: newField.name,
      formula: newField.formula,
      type: newField.type as "number" | "boolean" | "text",
    };

    setCustomFields(prev => [...prev, field]);
    setColumns(prev => [...prev, { key: fieldId, label: newField.name, visible: true, isCustom: true }]);
    setNewField({ name: "", formula: "", type: "number" });
    setNewFieldDialog(false);
    toast.success("Custom field added");
  };

  const removeCustomField = (fieldId: string) => {
    setCustomFields(prev => prev.filter(f => f.id !== fieldId));
    setColumns(prev => prev.filter(col => col.key !== fieldId));
    toast.success("Custom field removed");
  };

  const handleExport = () => {
    const visibleCols = columns.filter(c => c.visible);
    const exportData = filteredData.map((d) => {
      const row: Record<string, unknown> = {};
      visibleCols.forEach(col => {
        if (col.isCustom) {
          const field = customFields.find(f => f.id === col.key);
          if (field) {
            row[col.label] = evaluateFormula(field.formula, d);
          }
        } else {
          switch (col.key) {
            case "inv_code": row[col.label] = d.inv_code; break;
            case "investor_name": row[col.label] = d.investor_name; break;
            case "rm_name": row[col.label] = d.rm_name; break;
            case "account_type": row[col.label] = d.account_type; break;
            case "investor_type": row[col.label] = d.investor_type; break;
            case "ledger_balance": row[col.label] = d.ledger_balance; break;
            case "market_value": row[col.label] = d.market_value; break;
            case "equity": row[col.label] = d.equity; break;
            case "total_deposits": row[col.label] = d.total_deposits; break;
            case "total_withdrawals": row[col.label] = d.total_withdrawals; break;
            case "adjusted_balance": row[col.label] = d.adjusted_balance; break;
            case "net_buy": row[col.label] = d.net_buy; break;
            case "net_sell": row[col.label] = d.net_sell; break;
            case "net_position": row[col.label] = d.net_position; break;
            case "trade_count": row[col.label] = d.trade_count; break;
            case "unique_securities_traded": row[col.label] = d.unique_securities_traded; break;
            case "violation_amount": row[col.label] = d.violation_amount; break;
            case "is_violation": row[col.label] = d.is_violation ? "VIOLATION" : "OK"; break;
          }
        }
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OverBuy Report");
    XLSX.writeFile(wb, `overbuy_report_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Report exported successfully");
  };

  const renderCellValue = (row: ClientOverBuyData, col: ColumnConfig) => {
    if (col.isCustom) {
      const field = customFields.find(f => f.id === col.key);
      if (field) {
        const value = evaluateFormula(field.formula, row);
        if (field.type === "boolean") {
          return value ? (
            <Badge variant="default" className="bg-green-600">Yes</Badge>
          ) : (
            <Badge variant="outline">No</Badge>
          );
        }
        if (field.type === "number" && typeof value === "number") {
          return formatCurrency(value);
        }
        return String(value);
      }
      return "-";
    }

    switch (col.key) {
      case "inv_code":
        return <span className="font-mono text-sm">{row.inv_code}</span>;
      case "investor_name":
        return row.investor_name;
      case "rm_name":
        return row.rm_name;
      case "account_type":
        return row.account_type || "-";
      case "investor_type":
        return row.investor_type || "-";
      case "ledger_balance":
        return <span className="font-mono">{formatCurrency(row.ledger_balance)}</span>;
      case "market_value":
        return <span className="font-mono">{formatCurrency(row.market_value)}</span>;
      case "equity":
        return <span className="font-mono">{formatCurrency(row.equity)}</span>;
      case "total_deposits":
        return <span className="font-mono text-green-600">{formatCurrency(row.total_deposits)}</span>;
      case "total_withdrawals":
        return <span className="font-mono text-red-600">{formatCurrency(row.total_withdrawals)}</span>;
      case "adjusted_balance":
        return <span className="font-mono font-medium">{formatCurrency(row.adjusted_balance)}</span>;
      case "net_buy":
        return <span className="font-mono">{formatCurrency(row.net_buy)}</span>;
      case "net_sell":
        return <span className="font-mono">{formatCurrency(row.net_sell)}</span>;
      case "net_position":
        return <span className="font-mono font-medium">{formatCurrency(row.net_position)}</span>;
      case "trade_count":
        return <span className="font-mono">{row.trade_count}</span>;
      case "unique_securities_traded":
        return <span className="font-mono">{row.unique_securities_traded}</span>;
      case "violation_amount":
        return <span className="font-mono text-destructive font-bold">{row.is_violation ? formatCurrency(row.violation_amount) : "-"}</span>;
      case "is_violation":
        return row.is_violation ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Violation
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3" />
            OK
          </Badge>
        );
      default:
        return "-";
    }
  };

  const visibleColumns = columns.filter(c => c.visible);

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            OverBuy Compliance Report
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor accounts where net buy exceeds adjusted ledger balance
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Column Settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-2" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="end">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Toggle Columns</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {columns.map((col) => (
                    <div key={col.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={col.key}
                          checked={col.visible}
                          onCheckedChange={() => toggleColumnVisibility(col.key)}
                        />
                        <Label htmlFor={col.key} className="text-sm cursor-pointer">
                          {col.label}
                        </Label>
                      </div>
                      {col.isCustom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => removeCustomField(col.key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Formula Help */}
          <Dialog open={helpDialog} onOpenChange={setHelpDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Formula Reference</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-medium mb-2">Basic Variables</h4>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <span>ledger_balance, market_value, equity</span>
                    <span>deposits, withdrawals, adjusted_balance</span>
                    <span>net_buy, net_sell, net_position</span>
                    <span>total_buy_qty, total_sell_qty, trade_count</span>
                    <span>account_type, investor_type, brokerage_commission</span>
                    <span>interest_rate, securities_traded, violation_amount</span>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Security Functions</h4>
                  <div className="space-y-1 font-mono text-xs bg-muted p-2 rounded">
                    <p>SECURITY_BUY("GP") - Buy value for GP</p>
                    <p>SECURITY_SELL("GP") - Sell value for GP</p>
                    <p>SECURITY_NET("GP") - Net value for GP</p>
                    <p>SECURITY_QTY("GP") - Net quantity for GP</p>
                    <p>HAS_SECURITY("GP") - Returns 1 if traded GP</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Category Functions</h4>
                  <div className="space-y-1 font-mono text-xs bg-muted p-2 rounded">
                    <p>CATEGORY_BUY("A") - Total buy in category A</p>
                    <p>CATEGORY_SELL("A") - Total sell in category A</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">File Functions</h4>
                  <div className="space-y-1 font-mono text-xs bg-muted p-2 rounded">
                    <p>FILE_TRADES("2024") - Trades from file containing "2024"</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Logic & Math</h4>
                  <div className="space-y-1 font-mono text-xs bg-muted p-2 rounded">
                    <p>IF(condition, true_value, false_value)</p>
                    <p>CONTAINS(account_type, "margin")</p>
                    <p>ABS(), MAX(), MIN(), ROUND()</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Examples</h4>
                  <div className="space-y-1 font-mono text-xs bg-muted p-2 rounded">
                    <p>net_position / adjusted_balance * 100</p>
                    <p>IF(net_position {">"} adjusted_balance, "Risk", "OK")</p>
                    <p>SECURITY_BUY("GP") + SECURITY_BUY("BEXIMCO")</p>
                    <p>IF(CONTAINS(account_type, "margin"), net_buy * 0.5, net_buy)</p>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Add Custom Field */}
          <Dialog open={newFieldDialog} onOpenChange={setNewFieldDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Field
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Custom Field</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Field Name</Label>
                  <Input
                    value={newField.name}
                    onChange={(e) => setNewField(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Risk Score"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Formula</Label>
                  <Textarea
                    value={newField.formula}
                    onChange={(e) => setNewField(prev => ({ ...prev, formula: e.target.value }))}
                    placeholder='e.g., SECURITY_BUY("GP") / net_buy * 100'
                    rows={3}
                  />
                  <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => setHelpDialog(true)}>
                    View formula reference
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Output Type</Label>
                  <Select
                    value={newField.type}
                    onValueChange={(v) => setNewField(prev => ({ ...prev, type: v as "number" | "boolean" | "text" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="number">Number (Currency)</SelectItem>
                      <SelectItem value="boolean">Yes/No</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewFieldDialog(false)}>Cancel</Button>
                <Button onClick={addCustomField}>Add Field</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-secondary/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Total Clients</p>
            <p className="text-2xl font-bold">{stats.totalClients}</p>
          </div>
          <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
            <p className="text-sm text-muted-foreground">Violations</p>
            <p className="text-2xl font-bold text-destructive">{stats.violationCount}</p>
          </div>
          <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
            <p className="text-sm text-muted-foreground">Total Violation Amount</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(stats.totalViolationAmount)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedRm} onValueChange={setSelectedRm}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by RM" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All RMs</SelectItem>
              {rmOptions.map((rm) => (
                <SelectItem key={rm} value={rm}>
                  {rm}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={showViolationsOnly ? "default" : "outline"}
            onClick={() => setShowViolationsOnly(!showViolationsOnly)}
            className="whitespace-nowrap"
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            {showViolationsOnly ? "Show All" : "Violations Only"}
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map((col) => (
                  <TableHead 
                    key={col.key}
                    className={["ledger_balance", "market_value", "equity", "total_deposits", "total_withdrawals", "adjusted_balance", "net_buy", "net_sell", "net_position", "trade_count", "unique_securities_traded", "violation_amount"].includes(col.key) || col.isCustom ? "text-right" : col.key === "is_violation" ? "text-center" : ""}
                  >
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {visibleColumns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length} className="text-center py-8 text-muted-foreground">
                    No data found
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.slice(0, 100).map((row) => (
                  <TableRow
                    key={row.inv_code}
                    className={row.is_violation ? "bg-destructive/5" : ""}
                  >
                    {visibleColumns.map((col) => (
                      <TableCell 
                        key={col.key}
                        className={["ledger_balance", "market_value", "equity", "total_deposits", "total_withdrawals", "adjusted_balance", "net_buy", "net_sell", "net_position", "trade_count", "unique_securities_traded", "violation_amount"].includes(col.key) || col.isCustom ? "text-right" : col.key === "is_violation" ? "text-center" : ""}
                      >
                        {renderCellValue(row, col)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {filteredData.length > 100 && (
          <p className="text-sm text-muted-foreground text-center">
            Showing first 100 of {filteredData.length} records. Use filters to narrow results.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
