/**
 * Shared type definitions for database services
 */

import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

// ============================================
// Pagination Types
// ============================================

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  cursor?: string; // For cursor-based pagination (keyset)
}

export interface PaginatedResponse<T> {
  data: T[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
  page?: number;
  pageSize?: number;
}

// ============================================
// Filter Types
// ============================================

export type FilterOperator = {
  eq?: string | number | boolean | null;
  neq?: string | number | boolean | null;
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
  like?: string;
  ilike?: string;
  in?: (string | number)[];
  is?: null | boolean;
};

export type FilterParams<T> = {
  [K in keyof T]?: FilterOperator | T[K];
};

export interface SortParams {
  column: string;
  ascending?: boolean;
}

export interface QueryOptions<T> {
  filters?: FilterParams<T>;
  sort?: SortParams;
  pagination?: PaginationParams;
}

// ============================================
// Progress Callback
// ============================================

export type ProgressCallback = (loaded: number, total?: number) => void;

// ============================================
// Entity Types (re-exported from Supabase)
// ============================================

export type Agent = Tables<"agents">;
export type AgentInsert = TablesInsert<"agents">;
export type AgentUpdate = TablesUpdate<"agents">;

export type AgentCode = Tables<"agent_codes">;
export type AgentCodeInsert = TablesInsert<"agent_codes">;

export type AgentTradeDetail = Tables<"agent_trade_details">;
export type AgentTradeDetailInsert = TablesInsert<"agent_trade_details">;

export type Employee = Tables<"employees">;
export type EmployeeInsert = TablesInsert<"employees">;
export type EmployeeUpdate = TablesUpdate<"employees">;

export type EmployeeSalary = Tables<"employee_salaries">;
export type EmployeeSalaryInsert = TablesInsert<"employee_salaries">;

export type Client = Tables<"clients">;
export type ClientInsert = TablesInsert<"clients">;

export type Investor = Tables<"investors">;
export type InvestorInsert = TablesInsert<"investors">;
export type InvestorUpdate = TablesUpdate<"investors">;

export type TradeHistory = Tables<"trade_history">;
export type TradeHistoryInsert = TablesInsert<"trade_history">;

export type DepositWithdrawal = Tables<"deposits_withdrawals">;
export type DepositWithdrawalInsert = TablesInsert<"deposits_withdrawals">;

export type BalanceRaw = Tables<"balances_raw">;
export type BalanceRawInsert = TablesInsert<"balances_raw">;

export type EodLedgerSnapshot = Tables<"eod_ledger_snapshots">;
export type EodRunHistory = Tables<"eod_run_history">;

export type Holding = Tables<"holdings">;
export type HoldingInsert = TablesInsert<"holdings">;

export type Security = Tables<"securities">;

export type InvestorRmAssignment = Tables<"investor_rm_assignments">;
export type InvestorAgentAssignment = Tables<"investor_agent_assignments">;

export type ReconciliationResult = Tables<"reconciliation_results">;

// ============================================
// Service-Specific Types
// ============================================

export interface TradeFilters {
  dateFrom?: string;
  dateTo?: string;
  clientCode?: string;
  securityCode?: string;
  side?: "BUY" | "SELL" | string;
  fileName?: string;
  rmName?: string;
  hideZeroValues?: boolean;
  status?: string;
}

export interface EmployeeFilters {
  department?: string;
  branch?: string;
  status?: string;
  designation?: string;
  search?: string;
}

export interface AgentFilters {
  rmId?: string;
  status?: string;
  search?: string;
}

export interface ClientFilters {
  rmName?: string;
  rmEmail?: string;
  status?: string;
  search?: string;
  hasNegativeBalance?: boolean;
}

export interface InvestorFilters {
  accountType?: string;
  investorType?: string;
  status?: string;
  search?: string;
}

export interface BalanceFilters {
  date: string;
  rmEmail?: string;
  cursorId?: string;
}

// ============================================
// RPC Response Types
// ============================================

export interface TradeFileStats {
  file_name: string;
  record_count: number;
  total_value: number;
  unique_clients: number;
  first_upload: string;
  last_upload: string;
}

export interface DepositImportStats {
  transaction_date: string;
  deposit_count: number;
  withdrawal_count: number;
  total_deposits: number;
  total_withdrawals: number;
  first_upload: string;
  last_upload: string;
}

export interface AccountingDataRow {
  investor_code: string;
  investor_name: string;
  rm: string;
  department: string;
  account_type: string;
  opening_balance: number;
  deposits: number;
  withdrawals: number;
  gross_buy: number;
  gross_sell: number;
  closing_balance: number;
}

export interface AccountingSummary {
  total_accounts: number;
  margin_accounts: number;
  total_buy: number;
  total_sell: number;
  total_trade_value: number;
  total_payable: number;
  total_receivable: number;
  total_margin_loan: number;
  total_accrued_interest: number;
  total_brokerage: number;
}

export interface BalancesSummary {
  total_clients: number;
  negative_ledger_count: number;
  total_mv_sum: number;
  total_cost_sum: number;
  unrealized_pnl_sum: number;
  cq_sum: number;
  receivable_sum: number;
  total_margin_loan: number;
  total_accrued_interest: number;
  total_brokerage: number;
}

export interface AdminBalanceRow {
  id: string;
  investor_code: string;
  as_of_date: string;
  rm_id: string;
  rm_name: string;
  rm_email: string;
  ledger_balance: number;
  total_mv: number;
  total_cost: number;
  unrealized_pnl: number;
  pnl_pct: number;
  cq_in_transit: number;
  receivable_sale: number;
  matured_balance: number;
  saleable: number;
  total_stock: number;
  avg_cost: number;
  instrument: string;
  account_type: string;
  interest_rate: number;
  brokerage_commission_rate: number;
  brokerage_amount: number;
  accrued_interest: number;
  deposits: number;
  withdrawals: number;
  gross_buy: number;
  gross_sell: number;
  net_buy: number;
  net_sell: number;
  adjusted_ledger: number;
  net_available: number;
  receivable_payable: number;
  risk_flag: string;
}

export interface NegativeBalanceRow {
  client_code: string;
  client_name: string;
  rm_name: string;
  event_date: string;
  closing_balance: number;
}

export interface TradeSums {
  client_code: string;
  buy_sum: number;
  sell_sum: number;
}

// ============================================
// Bulk Operation Results
// ============================================

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: string[];
  total: number;
}

export interface ServiceError {
  code: string;
  message: string;
  details?: unknown;
}
