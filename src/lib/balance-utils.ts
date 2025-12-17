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
  rm_id: string | null;
  rm_name: string | null;
}

export interface InvestorAdjustment {
  deposits: number;
  withdrawals: number;
  net_sell: number;
  net_buy: number;
}

export interface InvestorData {
  interest_rate: number;
  brokerage_commission: number;
  account_type: string | null;
}

export interface EnrichedBalanceRow extends BalanceRawRow {
  unrealized_pnl: number;
  pnl_pct: number | null;
  net_available: number;
  risk_flag: 'OK' | 'Watch' | 'High';
  adjusted_ledger: number;
  deposits: number;
  withdrawals: number;
  net_sell: number;
  net_buy: number;
  accrued_interest: number;
  receivable_payable: number;
  brokerage_commission_rate: number;
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
  adjusted_ledger: number;
  deposits: number;
  withdrawals: number;
  net_sell: number;
  net_buy: number;
  accrued_interest: number;
  receivable_payable: number;
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

export interface PortfolioSummary {
  portfolio_id: string;
  portfolio_name: string;
  description: string | null;
  investor_codes: string[];
  investor_count: number;
  total_qty: number;
  total_cost: number;
  total_mv: number;
  unrealized_pnl: number;
  pnl_pct: number | null;
  ledger_balance: number;
  adjusted_ledger: number;
  risk_flag: 'OK' | 'Watch' | 'High';
}

export interface RMSummary {
  rm_id: string;
  rm_name: string | null;
  investor_codes: string[];
  investor_count: number;
  portfolio_names: string[];
  portfolio_count: number;
  total_qty: number;
  total_cost: number;
  total_mv: number;
  unrealized_pnl: number;
  pnl_pct: number | null;
  ledger_balance: number;
  adjusted_ledger: number;
  risk_flag: 'OK' | 'Watch' | 'High';
}

export interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  investor_code: string;
}

// Calculate risk flag based on adjusted ledger balance and P&L %
export function calculateRiskFlag(adjustedLedger: number, pnlPct: number | null): 'OK' | 'Watch' | 'High' {
  if (adjustedLedger < -200000 || (pnlPct !== null && pnlPct < -20)) {
    return 'High';
  }
  if (adjustedLedger < 0 || (pnlPct !== null && pnlPct < -5)) {
    return 'Watch';
  }
  return 'OK';
}

// Enrich raw balance row with computed fields including next-day adjustments
export function enrichBalanceRow(
  row: BalanceRawRow, 
  adjustments?: Record<string, InvestorAdjustment>,
  investorDataMap?: Record<string, InvestorData>
): EnrichedBalanceRow {
  const adjustment = adjustments?.[row.investor_code] || { deposits: 0, withdrawals: 0, net_sell: 0, net_buy: 0 };
  const investorData = investorDataMap?.[row.investor_code] || { interest_rate: 0, brokerage_commission: 0, account_type: null };
  
  const unrealized_pnl = row.total_mv - row.total_cost;
  const pnl_pct = row.total_cost !== 0 ? (unrealized_pnl / row.total_cost) * 100 : null;
  
  // Adjusted ledger = ledger_balance + deposits - withdrawals + net_sell
  const adjusted_ledger = row.ledger_balance + adjustment.deposits - adjustment.withdrawals + adjustment.net_sell;
  
  // Accrued Interest: Only for margin accounts with negative adjusted ledger
  // Formula: (interest_rate / 365) * abs(negative_adjusted_ledger)
  const isMarginAccount = investorData.account_type?.toLowerCase() === 'margin';
  const accrued_interest = isMarginAccount && adjusted_ledger < 0 
    ? (investorData.interest_rate / 365) * Math.abs(adjusted_ledger) / 100
    : 0;
  
  // Receivable/Payable: net_sell = receivable (positive), net_buy = payable (negative when buying)
  // Positive = receivable from broker, Negative = payable to broker
  const receivable_payable = adjustment.net_sell;
  
  // Net available = matured + (saleable * price per unit) - receivable - cq
  const pricePerUnit = row.total_stock > 0 ? row.total_mv / row.total_stock : 0;
  const net_available = row.matured_balance + (row.saleable * pricePerUnit) - row.receivable_sale - row.cq_in_transit;
  
  // Risk flag now uses adjusted_ledger instead of raw ledger_balance
  const risk_flag = calculateRiskFlag(adjusted_ledger, pnl_pct);

  return {
    ...row,
    unrealized_pnl,
    pnl_pct,
    net_available,
    risk_flag,
    adjusted_ledger,
    deposits: adjustment.deposits,
    withdrawals: adjustment.withdrawals,
    net_sell: adjustment.net_sell,
    net_buy: adjustment.net_buy,
    accrued_interest,
    receivable_payable,
    brokerage_commission_rate: investorData.brokerage_commission,
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
    
    // Use adjusted_ledger for negative count
    if (row.adjusted_ledger < 0) {
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
    const ledger_balance = instruments[0]?.ledger_balance || 0;
    const adjusted_ledger = instruments[0]?.adjusted_ledger || 0;
    const deposits = instruments[0]?.deposits || 0;
    const withdrawals = instruments[0]?.withdrawals || 0;
    const net_sell = instruments[0]?.net_sell || 0;
    const net_buy = instruments[0]?.net_buy || 0;
    const accrued_interest = instruments[0]?.accrued_interest || 0;
    const receivable_payable = instruments[0]?.receivable_payable || 0;
    
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
      adjusted_ledger,
      deposits,
      withdrawals,
      net_sell,
      net_buy,
      accrued_interest,
      receivable_payable,
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

// Group by portfolio
export function groupByPortfolio(rows: EnrichedBalanceRow[], portfolios: Portfolio[]): PortfolioSummary[] {
  // Create a map of investor_code -> portfolio
  const investorToPortfolio: Record<string, Portfolio> = {};
  portfolios.forEach(p => {
    investorToPortfolio[p.investor_code] = p;
  });

  // Group rows by portfolio
  const grouped: Record<string, { portfolio: Portfolio; rows: EnrichedBalanceRow[]; investorCodes: Set<string> }> = {};
  
  rows.forEach(row => {
    const portfolio = investorToPortfolio[row.investor_code];
    if (!portfolio) return; // Skip rows without portfolio assignment
    
    if (!grouped[portfolio.id]) {
      grouped[portfolio.id] = { portfolio, rows: [], investorCodes: new Set() };
    }
    grouped[portfolio.id].rows.push(row);
    grouped[portfolio.id].investorCodes.add(row.investor_code);
  });

  return Object.entries(grouped).map(([portfolioId, data]) => {
    const total_qty = data.rows.reduce((sum, r) => sum + r.total_stock, 0);
    const total_cost = data.rows.reduce((sum, r) => sum + r.total_cost, 0);
    const total_mv = data.rows.reduce((sum, r) => sum + r.total_mv, 0);
    const unrealized_pnl = total_mv - total_cost;
    const pnl_pct = total_cost !== 0 ? (unrealized_pnl / total_cost) * 100 : null;
    
    // Sum unique ledger and adjusted_ledger balances per investor
    const ledgerByInvestor: Record<string, number> = {};
    const adjustedByInvestor: Record<string, number> = {};
    data.rows.forEach(r => {
      ledgerByInvestor[r.investor_code] = r.ledger_balance;
      adjustedByInvestor[r.investor_code] = r.adjusted_ledger;
    });
    const ledger_balance = Object.values(ledgerByInvestor).reduce((sum, v) => sum + v, 0);
    const adjusted_ledger = Object.values(adjustedByInvestor).reduce((sum, v) => sum + v, 0);
    
    // Highest risk flag
    const riskFlags = data.rows.map(r => r.risk_flag);
    const risk_flag = riskFlags.includes('High') ? 'High' : riskFlags.includes('Watch') ? 'Watch' : 'OK';

    return {
      portfolio_id: portfolioId,
      portfolio_name: data.portfolio.name,
      description: data.portfolio.description,
      investor_codes: Array.from(data.investorCodes),
      investor_count: data.investorCodes.size,
      total_qty,
      total_cost,
      total_mv,
      unrealized_pnl,
      pnl_pct,
      ledger_balance,
      adjusted_ledger,
      risk_flag,
    };
  });
}

// Group by RM
export function groupByRM(rows: EnrichedBalanceRow[], portfolios: Portfolio[]): RMSummary[] {
  // Create a map of investor_code -> portfolio names
  const investorToPortfolios: Record<string, string[]> = {};
  portfolios.forEach(p => {
    if (!investorToPortfolios[p.investor_code]) {
      investorToPortfolios[p.investor_code] = [];
    }
    investorToPortfolios[p.investor_code].push(p.name);
  });

  // Group rows by RM
  const grouped: Record<string, { 
    rm_name: string | null; 
    rows: EnrichedBalanceRow[]; 
    investorCodes: Set<string>;
    portfolioNames: Set<string>;
  }> = {};
  
  rows.forEach(row => {
    const rmId = (row as any).rm_id || 'Unknown';
    const rmName = (row as any).rm_name || null;
    
    if (!grouped[rmId]) {
      grouped[rmId] = { rm_name: rmName, rows: [], investorCodes: new Set(), portfolioNames: new Set() };
    }
    grouped[rmId].rows.push(row);
    grouped[rmId].investorCodes.add(row.investor_code);
    
    // Add portfolio names for this investor
    const portfolioNamesForInvestor = investorToPortfolios[row.investor_code] || [];
    portfolioNamesForInvestor.forEach(name => grouped[rmId].portfolioNames.add(name));
  });

  return Object.entries(grouped).map(([rmId, data]) => {
    const total_qty = data.rows.reduce((sum, r) => sum + r.total_stock, 0);
    const total_cost = data.rows.reduce((sum, r) => sum + r.total_cost, 0);
    const total_mv = data.rows.reduce((sum, r) => sum + r.total_mv, 0);
    const unrealized_pnl = total_mv - total_cost;
    const pnl_pct = total_cost !== 0 ? (unrealized_pnl / total_cost) * 100 : null;
    
    // Sum unique ledger and adjusted_ledger balances per investor
    const ledgerByInvestor: Record<string, number> = {};
    const adjustedByInvestor: Record<string, number> = {};
    data.rows.forEach(r => {
      ledgerByInvestor[r.investor_code] = r.ledger_balance;
      adjustedByInvestor[r.investor_code] = r.adjusted_ledger;
    });
    const ledger_balance = Object.values(ledgerByInvestor).reduce((sum, v) => sum + v, 0);
    const adjusted_ledger = Object.values(adjustedByInvestor).reduce((sum, v) => sum + v, 0);
    
    // Highest risk flag
    const riskFlags = data.rows.map(r => r.risk_flag);
    const risk_flag = riskFlags.includes('High') ? 'High' : riskFlags.includes('Watch') ? 'Watch' : 'OK';

    return {
      rm_id: rmId,
      rm_name: data.rm_name,
      investor_codes: Array.from(data.investorCodes),
      investor_count: data.investorCodes.size,
      portfolio_names: Array.from(data.portfolioNames),
      portfolio_count: data.portfolioNames.size,
      total_qty,
      total_cost,
      total_mv,
      unrealized_pnl,
      pnl_pct,
      ledger_balance,
      adjusted_ledger,
      risk_flag,
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
