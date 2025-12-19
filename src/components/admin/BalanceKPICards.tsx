import { useState } from "react";
import { Users, TrendingUp, TrendingDown, Wallet, AlertCircle, Percent, ArrowUpRight, ArrowDownRight, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Format number in Crore (1 Cr = 10,000,000)
const formatCrore = (value: number): string => {
  const crore = value / 10000000;
  if (Math.abs(crore) >= 100) {
    return `${crore.toFixed(0)} Cr`;
  } else if (Math.abs(crore) >= 10) {
    return `${crore.toFixed(1)} Cr`;
  } else if (Math.abs(crore) >= 1) {
    return `${crore.toFixed(2)} Cr`;
  } else {
    return `${(value / 100000).toFixed(2)} L`;
  }
};

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

interface BalanceSummary {
  total_clients: number;
  total_mv_sum: number;
  total_cost_sum: number;
  unrealized_pnl_sum: number;
  negative_ledger_clients_count: number;
  receivable_sum: number;
  cq_sum: number;
  total_accrued_interest: number;
  total_margin_loan: number;
  total_brokerage?: number;
}

interface BalanceRow {
  investor_code: string;
  total_mv: number;
  total_cost: number;
  unrealized_pnl: number;
  pnl_pct: number | null;
  adjusted_ledger: number;
  receivable_sale: number;
  cq_in_transit: number;
  accrued_interest: number;
  risk_flag: 'OK' | 'Watch' | 'High';
  account_type?: string;
  net_available?: number;
}

interface BalanceKPICardsProps {
  summary: BalanceSummary;
  balanceData?: BalanceRow[];
}

export function BalanceKPICards({ summary, balanceData = [] }: BalanceKPICardsProps) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<string>("");
  const [drilldownData, setDrilldownData] = useState<BalanceRow[]>([]);

  // Calculate account type breakdowns
  const cashAccounts = balanceData.filter(r => r.account_type === 'Cash' || !r.account_type).length;
  const marginAccounts = balanceData.filter(r => r.account_type === 'Margin').length;
  const uniqueInvestors = new Set(balanceData.map(r => r.investor_code)).size;
  
  // Calculate negative equity (where total_mv - total_cost + adjusted_ledger < 0)
  const negativeEquityClients = balanceData.filter(r => {
    const equity = r.total_mv + r.adjusted_ledger;
    return equity < 0;
  });
  const negativeEquityCount = new Set(negativeEquityClients.map(r => r.investor_code)).size;
  const negativeEquityTotal = negativeEquityClients.reduce((sum, r) => sum + (r.total_mv + r.adjusted_ledger), 0);

  const handleKPIClick = (type: string) => {
    let filtered: BalanceRow[] = [];
    
    switch (type) {
      case 'negative_ledger':
        filtered = balanceData.filter(r => r.adjusted_ledger < 0);
        break;
      case 'negative_equity':
        filtered = negativeEquityClients;
        break;
      case 'receivables':
        filtered = balanceData.filter(r => (r.receivable_sale + r.cq_in_transit) > 0);
        break;
      case 'accrued_interest':
        filtered = balanceData.filter(r => r.accrued_interest > 0);
        break;
      case 'margin_loan':
        filtered = balanceData.filter(r => r.adjusted_ledger < 0);
        break;
      case 'unrealized_pnl':
        filtered = [...balanceData].sort((a, b) => a.unrealized_pnl - b.unrealized_pnl);
        break;
      case 'cash_accounts':
        filtered = balanceData.filter(r => r.account_type === 'Cash' || !r.account_type);
        break;
      case 'margin_accounts':
        filtered = balanceData.filter(r => r.account_type === 'Margin');
        break;
      default:
        filtered = balanceData.slice(0, 50);
    }

    // Deduplicate by investor_code
    const seen = new Set<string>();
    filtered = filtered.filter(r => {
      if (seen.has(r.investor_code)) return false;
      seen.add(r.investor_code);
      return true;
    }).slice(0, 100);

    setDrilldownType(type);
    setDrilldownData(filtered);
    setDrilldownOpen(true);
  };

  const getDrilldownTitle = () => {
    switch (drilldownType) {
      case 'negative_ledger': return 'Clients with Negative Ledger';
      case 'negative_equity': return 'Clients with Negative Equity';
      case 'receivables': return 'Clients with Pending Receivables';
      case 'accrued_interest': return 'Clients with Accrued Interest';
      case 'margin_loan': return 'Clients with Margin Loan';
      case 'unrealized_pnl': return 'Clients by Unrealized P&L';
      case 'cash_accounts': return 'Cash Account Clients';
      case 'margin_accounts': return 'Margin Account Clients';
      default: return 'Client Details';
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Investor Statistics Card */}
        <div 
          className="rounded-xl p-5 border bg-card hover:shadow-md transition-all cursor-pointer"
          onClick={() => handleKPIClick('cash_accounts')}
        >
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Investor Statistics</span>
          </div>
          <p className="text-3xl font-bold text-foreground mb-3">{uniqueInvestors || summary.total_clients}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div 
              className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 hover:bg-muted transition-colors"
              onClick={(e) => { e.stopPropagation(); handleKPIClick('cash_accounts'); }}
            >
              <span className="text-muted-foreground">Cash</span>
              <span className="font-semibold text-foreground">{cashAccounts}</span>
            </div>
            <div 
              className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 hover:bg-muted transition-colors"
              onClick={(e) => { e.stopPropagation(); handleKPIClick('margin_accounts'); }}
            >
              <span className="text-muted-foreground">Margin</span>
              <span className="font-semibold text-foreground">{marginAccounts}</span>
            </div>
          </div>
        </div>

        {/* Portfolio Value Card */}
        <div className="rounded-xl p-5 border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <PieChart className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Portfolio Value</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Market Value</span>
              <span className="text-lg font-semibold text-foreground">{formatCrore(summary.total_mv_sum)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Cost</span>
              <span className="text-lg font-semibold text-foreground">{formatCrore(summary.total_cost_sum)}</span>
            </div>
            <div 
              className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              onClick={() => handleKPIClick('unrealized_pnl')}
            >
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                Unrealized P&L
                {summary.unrealized_pnl_sum >= 0 
                  ? <TrendingUp className="h-3 w-3 text-success" />
                  : <TrendingDown className="h-3 w-3 text-destructive" />
                }
              </span>
              <span className={cn(
                "text-lg font-semibold",
                summary.unrealized_pnl_sum >= 0 ? "text-success" : "text-destructive"
              )}>
                {formatCrore(summary.unrealized_pnl_sum)}
              </span>
            </div>
          </div>
        </div>

        {/* Credit & Collections Card */}
        <div className="rounded-xl p-5 border bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Credit & Collections</span>
          </div>
          <div className="space-y-3">
            <div 
              className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              onClick={() => handleKPIClick('accrued_interest')}
            >
              <span className="text-sm text-muted-foreground">Accrued Interest</span>
              <span className="text-lg font-semibold text-amber-500">{formatCrore(summary.total_accrued_interest)}</span>
            </div>
            <div 
              className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              onClick={() => handleKPIClick('receivables')}
            >
              <span className="text-sm text-muted-foreground">Receivables</span>
              <span className="text-lg font-semibold text-amber-500">{formatCrore(summary.receivable_sum + summary.cq_sum)}</span>
            </div>
            <div 
              className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              onClick={() => handleKPIClick('margin_loan')}
            >
              <span className="text-sm text-muted-foreground">Margin Loan</span>
              <span className="text-lg font-semibold text-foreground">{formatCrore(summary.total_margin_loan)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Indicators Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Negative Ledger Card */}
        <div 
          className="rounded-xl p-4 border bg-destructive/5 border-destructive/20 cursor-pointer hover:shadow-md transition-all"
          onClick={() => handleKPIClick('negative_ledger')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-sm font-medium text-muted-foreground">Negative Ledger</span>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-destructive">{summary.negative_ledger_clients_count}</p>
              <p className="text-xs text-muted-foreground">clients</p>
            </div>
          </div>
        </div>

        {/* Negative Equity Card */}
        <div 
          className="rounded-xl p-4 border bg-destructive/5 border-destructive/20 cursor-pointer hover:shadow-md transition-all"
          onClick={() => handleKPIClick('negative_equity')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <span className="text-sm font-medium text-muted-foreground">Negative Equity</span>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-destructive">{negativeEquityCount}</p>
              <p className="text-xs text-muted-foreground">{formatCrore(Math.abs(negativeEquityTotal))} exposure</p>
            </div>
          </div>
        </div>
      </div>

      {/* Drilldown Modal */}
      <Dialog open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{getDrilldownTitle()}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Investor Code</TableHead>
                  <TableHead className="text-right">Market Value</TableHead>
                  <TableHead className="text-right">Unrealized P&L</TableHead>
                  <TableHead className="text-right">Adjusted Ledger</TableHead>
                  <TableHead className="text-right">Equity</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drilldownData.map((row, idx) => {
                  const equity = row.total_mv + row.adjusted_ledger;
                  return (
                    <TableRow key={`${row.investor_code}-${idx}`}>
                      <TableCell className="font-medium">{row.investor_code}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.total_mv)}</TableCell>
                      <TableCell className={cn("text-right", row.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                        {formatCurrency(row.unrealized_pnl)}
                      </TableCell>
                      <TableCell className={cn("text-right", row.adjusted_ledger < 0 && "text-destructive")}>
                        {formatCurrency(row.adjusted_ledger)}
                      </TableCell>
                      <TableCell className={cn("text-right", equity < 0 && "text-destructive")}>
                        {formatCurrency(equity)}
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs",
                          row.risk_flag === 'High' && "bg-destructive/20 text-destructive",
                          row.risk_flag === 'Watch' && "bg-amber-500/20 text-amber-400",
                          row.risk_flag === 'OK' && "bg-muted text-muted-foreground"
                        )}>
                          {row.risk_flag}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {drilldownData.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                No clients found for this criteria
              </div>
            )}
          </div>
          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Showing {drilldownData.length} clients
            </span>
            <Button variant="outline" onClick={() => setDrilldownOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
