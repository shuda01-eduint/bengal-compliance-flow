import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, Filter } from "lucide-react";

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

interface ReconciliationResultsProps {
  results: ReconciliationResult[];
}

const statusPriority: Record<string, number> = {
  'unmatched': 1,
  'warning': 2,
  'matched': 3,
};

export function ReconciliationResults({ results }: ReconciliationResultsProps) {
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const matched = results.filter(r => r.status === 'matched').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const unmatched = results.filter(r => r.status === 'unmatched').length;

  const filteredResults = useMemo(() => {
    let data = [...results];
    
    // Apply filter
    if (statusFilter !== "all") {
      data = data.filter(r => r.status === statusFilter);
    }
    
    // Apply sort
    if (sortDirection) {
      data.sort((a, b) => {
        const aPriority = statusPriority[a.status] || 0;
        const bPriority = statusPriority[b.status] || 0;
        return sortDirection === "asc" ? aPriority - bPriority : bPriority - aPriority;
      });
    }
    
    return data;
  }, [results, statusFilter, sortDirection]);

  const handleSortClick = () => {
    if (sortDirection === null) setSortDirection("asc");
    else if (sortDirection === "asc") setSortDirection("desc");
    else setSortDirection(null);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-BD', {
      style: 'currency',
      currency: 'BDT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'matched':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'unmatched':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">Matched</Badge>;
      case 'warning':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">Warning</Badge>;
      case 'unmatched':
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">Unmatched</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-green-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Matched</p>
                <p className="text-3xl font-bold text-green-500">{matched}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-yellow-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-sm text-muted-foreground">Warnings</p>
                <p className="text-3xl font-bold text-yellow-500">{warnings}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Unmatched</p>
                <p className="text-3xl font-bold text-red-500">{unmatched}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Reconciliation Details</CardTitle>
            <div className="flex items-center gap-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filter by Status:</span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({results.length})</SelectItem>
                  <SelectItem value="matched">Matched ({matched})</SelectItem>
                  <SelectItem value="warning">Warning ({warnings})</SelectItem>
                  <SelectItem value="unmatched">Unmatched ({unmatched})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={handleSortClick}
                  >
                    <div className="flex items-center gap-1">
                      Status
                      {sortDirection === "asc" ? (
                        <ArrowUp className="h-4 w-4" />
                      ) : sortDirection === "desc" ? (
                        <ArrowDown className="h-4 w-4" />
                      ) : (
                        <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Client Code</TableHead>
                  <TableHead>Investor Name</TableHead>
                  <TableHead>RM Name</TableHead>
                  <TableHead className="text-right">Buy Value</TableHead>
                  <TableHead className="text-right">Sell Value</TableHead>
                  <TableHead className="text-right">Net Value</TableHead>
                  <TableHead className="text-right">Ledger Balance</TableHead>
                  <TableHead>Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.map((result, index) => (
                  <TableRow key={index} className={result.status === 'unmatched' ? 'bg-red-500/5' : result.status === 'warning' ? 'bg-yellow-500/5' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(result.status)}
                        {getStatusBadge(result.status)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{result.inv_code}</TableCell>
                    <TableCell>{result.investor_name}</TableCell>
                    <TableCell>{result.rm_name}</TableCell>
                    <TableCell className="text-right text-green-500">{formatCurrency(result.total_buy_value)}</TableCell>
                    <TableCell className="text-right text-red-500">{formatCurrency(result.total_sell_value)}</TableCell>
                    <TableCell className={`text-right font-medium ${result.net_value >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatCurrency(result.net_value)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(result.current_ledger_balance)}</TableCell>
                    <TableCell>
                      {result.issues.length > 0 ? (
                        <ul className="text-xs text-muted-foreground">
                          {result.issues.map((issue, i) => (
                            <li key={i}>• {issue}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {statusFilter !== "all" && (
            <p className="text-sm text-muted-foreground mt-3">
              Showing {filteredResults.length} of {results.length} results
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
