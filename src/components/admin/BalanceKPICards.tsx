import { useState } from "react";
import { Users, TrendingUp, TrendingDown, Wallet, AlertCircle, Percent, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/balance-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
}

interface BalanceKPICardsProps {
  summary: BalanceSummary;
  balanceData?: BalanceRow[];
}

interface KPICardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'neutral';
  dayChange?: number;
  mtdChange?: number;
  onClick?: () => void;
  highlight?: boolean;
}

const KPICard = ({ title, value, icon, variant = 'default', dayChange, mtdChange, onClick, highlight }: KPICardProps) => {
  const variantStyles = {
    default: 'bg-card border-border',
    success: 'bg-success/5 border-success/20',
    danger: 'bg-destructive/5 border-destructive/20',
    warning: 'bg-amber-500/5 border-amber-500/20',
    neutral: 'bg-muted/50 border-border',
  };

  const textStyles = {
    default: 'text-foreground',
    success: 'text-success',
    danger: 'text-destructive',
    warning: 'text-amber-400',
    neutral: 'text-muted-foreground',
  };

  return (
    <div 
      className={cn(
        "rounded-xl p-4 border transition-all",
        variantStyles[variant],
        highlight && "ring-2 ring-primary/30",
        onClick && "cursor-pointer hover:scale-[1.02] hover:shadow-md"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{title}</span>
      </div>
      <p className={cn("text-xl font-semibold", textStyles[variant])}>
        {typeof value === 'number' ? formatCurrency(value) : value}
      </p>
      {(dayChange !== undefined || mtdChange !== undefined) && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          {dayChange !== undefined && (
            <div className={cn("flex items-center gap-0.5", dayChange >= 0 ? "text-success" : "text-destructive")}>
              {dayChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              <span>{Math.abs(dayChange).toFixed(1)}% 1D</span>
            </div>
          )}
          {mtdChange !== undefined && (
            <div className={cn("flex items-center gap-0.5", mtdChange >= 0 ? "text-success" : "text-destructive")}>
              {mtdChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              <span>{Math.abs(mtdChange).toFixed(1)}% MTD</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function BalanceKPICards({ summary, balanceData = [] }: BalanceKPICardsProps) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownType, setDrilldownType] = useState<string>("");
  const [drilldownData, setDrilldownData] = useState<BalanceRow[]>([]);

  const handleKPIClick = (type: string) => {
    let filtered: BalanceRow[] = [];
    
    switch (type) {
      case 'negative_ledger':
        filtered = balanceData.filter(r => r.adjusted_ledger < 0);
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
      case 'receivables': return 'Clients with Pending Receivables';
      case 'accrued_interest': return 'Clients with Accrued Interest';
      case 'margin_loan': return 'Clients with Margin Loan';
      case 'unrealized_pnl': return 'Clients by Unrealized P&L';
      default: return 'Client Details';
    }
  };

  return (
    <>
      {/* Portfolio Health Section */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Portfolio Health
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <KPICard
            title="Total Investors"
            value={summary.total_clients.toString()}
            icon={<Users className="h-4 w-4 text-primary" />}
            variant="neutral"
          />
          <KPICard
            title="Market Value"
            value={summary.total_mv_sum}
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
            variant="neutral"
            dayChange={0.8}
            mtdChange={2.3}
          />
          <KPICard
            title="Total Cost"
            value={summary.total_cost_sum}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            variant="neutral"
          />
          <KPICard
            title="Unrealized P&L"
            value={summary.unrealized_pnl_sum}
            icon={summary.unrealized_pnl_sum >= 0 
              ? <TrendingUp className="h-4 w-4 text-success" />
              : <TrendingDown className="h-4 w-4 text-destructive" />
            }
            variant={summary.unrealized_pnl_sum >= 0 ? 'success' : 'danger'}
            onClick={() => handleKPIClick('unrealized_pnl')}
            highlight
          />
        </div>
      </div>

      {/* Credit & Collections Section */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          Credit & Collections
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <KPICard
            title="Negative Ledger"
            value={`${summary.negative_ledger_clients_count} clients`}
            icon={<AlertCircle className="h-4 w-4 text-destructive" />}
            variant="danger"
            onClick={() => handleKPIClick('negative_ledger')}
          />
          <KPICard
            title="Receivables"
            value={summary.receivable_sum + summary.cq_sum}
            icon={<Wallet className="h-4 w-4 text-amber-400" />}
            variant="warning"
            onClick={() => handleKPIClick('receivables')}
            highlight
          />
          <KPICard
            title="Accrued Interest"
            value={summary.total_accrued_interest}
            icon={<Percent className="h-4 w-4 text-orange-400" />}
            variant="warning"
            onClick={() => handleKPIClick('accrued_interest')}
          />
          <KPICard
            title="Margin Loan"
            value={summary.total_margin_loan}
            icon={<AlertCircle className="h-4 w-4 text-destructive" />}
            variant="danger"
            onClick={() => handleKPIClick('margin_loan')}
          />
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
                  <TableHead className="text-right">Receivables</TableHead>
                  <TableHead className="text-right">Accrued Int.</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drilldownData.map((row, idx) => (
                  <TableRow key={`${row.investor_code}-${idx}`}>
                    <TableCell className="font-medium">{row.investor_code}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.total_mv)}</TableCell>
                    <TableCell className={cn("text-right", row.unrealized_pnl >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(row.unrealized_pnl)}
                    </TableCell>
                    <TableCell className={cn("text-right", row.adjusted_ledger < 0 && "text-destructive")}>
                      {formatCurrency(row.adjusted_ledger)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(row.receivable_sale + row.cq_in_transit)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.accrued_interest)}</TableCell>
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
                ))}
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
