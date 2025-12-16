// Utility functions for balance calculations

export interface BalanceRawRow {
  id: string;
  as_of_date: string;
  investor_code: string;
  instrument: string | null;
  total_stock: number;
  saleable: number;
  avg_cost: number;
  total_cost: number;
  total_mv: number;
  ledger_balance: number;
  matured_balance: number;
  receivable_sale: number;
  cq_in_transit: number;
}

export interface EnrichedBalanceRow extends BalanceRawRow {
  unrealized_pnl: number;
  pnl_pct: number | null;
  net_available: number;
  risk_flag: 'OK' | 'Watch' | 'High';
}

export interface BalanceSummary {
  total_cost_sum: number;
  total_mv_sum: number;
  unrealized_pnl_sum: number;
  negative_ledger_clients_count: number;
  receivable_sum: number;
  cq_sum: number;
  total_clients: number;
}

export interface InvestorGroupedRow {
  investor_code: string;
  total_cost: number;
  total_mv: number;
  unrealized_pnl: number;
  pnl_pct: number | null;
  ledger_balance: number;
  risk_flag: 'OK' | 'Watch' | 'High';
  instruments: EnrichedBalanceRow[];
}

export interface InstrumentSummary {
  instrument: string;
  total_qty: number;
  total_cost: number;
  total_mv: number;
  unrealized_pnl: number;
  pnl_pct: number | null;
  investor_count: number;
}

// Calculate risk flag based on ledger balance and P&L %
export function calculateRiskFlag(ledgerBalance: number, pnlPct: number | null): 'OK' | 'Watch' | 'High' {
  if (ledgerBalance < -200000 || (pnlPct !== null && pnlPct < -20)) {
    return 'High';
  }
  if (ledgerBalance < 0 || (pnlPct !== null && pnlPct < -5)) {
    return 'Watch';
  }
  return 'OK';
}

// Enrich raw balance row with computed fields
export function enrichBalanceRow(row: BalanceRawRow): EnrichedBalanceRow {
  const unrealized_pnl = row.total_mv - row.total_cost;
  const pnl_pct = row.total_cost !== 0 ? (unrealized_pnl / row.total_cost) * 100 : null;
  
  // Net available = matured + (saleable * price per unit) - receivable - cq
  const pricePerUnit = row.total_stock > 0 ? row.total_mv / row.total_stock : 0;
  const net_available = row.matured_balance + (row.saleable * pricePerUnit) - row.receivable_sale - row.cq_in_transit;
  
  const risk_flag = calculateRiskFlag(row.ledger_balance, pnl_pct);

  return {
    ...row,
    unrealized_pnl,
    pnl_pct,
    net_available,
    risk_flag,
  };
}

// Calculate summary totals
export function calculateSummary(rows: EnrichedBalanceRow[]): BalanceSummary {
  const uniqueInvestors = new Set<string>();
  const negativeInvestors = new Set<string>();

  let total_cost_sum = 0;
  let total_mv_sum = 0;
  let unrealized_pnl_sum = 0;
  let receivable_sum = 0;
  let cq_sum = 0;

  rows.forEach(row => {
    uniqueInvestors.add(row.investor_code);
    total_cost_sum += row.total_cost;
    total_mv_sum += row.total_mv;
    unrealized_pnl_sum += row.unrealized_pnl;
    receivable_sum += row.receivable_sale;
    cq_sum += row.cq_in_transit;
    
    if (row.ledger_balance < 0) {
      negativeInvestors.add(row.investor_code);
    }
  });

  return {
    total_cost_sum,
    total_mv_sum,
    unrealized_pnl_sum,
    negative_ledger_clients_count: negativeInvestors.size,
    receivable_sum,
    cq_sum,
    total_clients: uniqueInvestors.size,
  };
}

// Group by investor
export function groupByInvestor(rows: EnrichedBalanceRow[]): InvestorGroupedRow[] {
  const grouped: Record<string, EnrichedBalanceRow[]> = {};
  
  rows.forEach(row => {
    if (!grouped[row.investor_code]) {
      grouped[row.investor_code] = [];
    }
    grouped[row.investor_code].push(row);
  });

  return Object.entries(grouped).map(([investor_code, instruments]) => {
    const total_cost = instruments.reduce((sum, r) => sum + r.total_cost, 0);
    const total_mv = instruments.reduce((sum, r) => sum + r.total_mv, 0);
    const unrealized_pnl = total_mv - total_cost;
    const pnl_pct = total_cost !== 0 ? (unrealized_pnl / total_cost) * 100 : null;
    const ledger_balance = instruments[0]?.ledger_balance || 0; // Same for all rows of investor
    
    // Highest risk flag
    const riskFlags = instruments.map(i => i.risk_flag);
    const risk_flag = riskFlags.includes('High') ? 'High' : riskFlags.includes('Watch') ? 'Watch' : 'OK';

    return {
      investor_code,
      total_cost,
      total_mv,
      unrealized_pnl,
      pnl_pct,
      ledger_balance,
      risk_flag,
      instruments,
    };
  });
}

// Group by instrument
export function groupByInstrument(rows: EnrichedBalanceRow[]): InstrumentSummary[] {
  const grouped: Record<string, EnrichedBalanceRow[]> = {};
  
  rows.forEach(row => {
    const key = row.instrument || 'N/A';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(row);
  });

  return Object.entries(grouped).map(([instrument, records]) => {
    const total_qty = records.reduce((sum, r) => sum + r.total_stock, 0);
    const total_cost = records.reduce((sum, r) => sum + r.total_cost, 0);
    const total_mv = records.reduce((sum, r) => sum + r.total_mv, 0);
    const unrealized_pnl = total_mv - total_cost;
    const pnl_pct = total_cost !== 0 ? (unrealized_pnl / total_cost) * 100 : null;
    const investor_count = new Set(records.map(r => r.investor_code)).size;

    return {
      instrument,
      total_qty,
      total_cost,
      total_mv,
      unrealized_pnl,
      pnl_pct,
      investor_count,
    };
  });
}

// Format currency
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Format number with decimals
export function formatNumber(value: number | null, decimals: number = 2): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// Format percentage
export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
