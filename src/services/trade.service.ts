/**
 * Trade Service - handles trade history, deposits/withdrawals, and accounting data
 */

import { supabase } from "@/integrations/supabase/client";
import { BaseService } from "./base.service";
import type {
  TradeHistory,
  TradeHistoryInsert,
  DepositWithdrawal,
  DepositWithdrawalInsert,
  TradeFilters,
  PaginationParams,
  PaginatedResponse,
  SortParams,
  TradeFileStats,
  DepositImportStats,
  AccountingDataRow,
  AccountingSummary,
  TradeSums,
  ProgressCallback,
} from "./types";

class TradeServiceClass extends BaseService<TradeHistory> {
  protected tableName = "trade_history";
  protected defaultSort = { column: "trade_date", ascending: false };

  /**
   * Get trades using the optimized RPC function with full filtering
   */
  async getAdminTrades(params?: {
    filters?: TradeFilters;
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<TradeHistory>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    const { data, error } = await supabase.rpc("get_admin_trades", {
      p_date_from: params?.filters?.dateFrom || null,
      p_date_to: params?.filters?.dateTo || null,
      p_search: params?.filters?.clientCode || params?.filters?.securityCode || null,
      p_side: params?.filters?.side || null,
      p_file_name: params?.filters?.fileName || null,
      p_status: params?.filters?.status || null,
      p_hide_zero_values: params?.filters?.hideZeroValues ?? false,
      p_limit: pageSize,
      p_offset: offset,
      p_sort_column: params?.sort?.column || "trade_date",
      p_sort_direction: params?.sort?.ascending ? "asc" : "desc",
    });

    if (error) throw error;

    const totalCount = data?.[0]?.total_count ?? 0;
    const hasMore = offset + (data?.length || 0) < totalCount;

    return {
      data: (data as unknown as TradeHistory[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get trade file statistics
   */
  async getFileStats(): Promise<TradeFileStats[]> {
    const { data, error } = await supabase.rpc("get_admin_trade_file_stats");

    if (error) throw error;

    return (data as TradeFileStats[]) || [];
  }

  /**
   * Get available trade dates for filtering
   */
  async getAvailableTradeDates(): Promise<string[]> {
    const { data, error } = await supabase
      .from("trade_history")
      .select("trade_date")
      .not("trade_date", "is", null)
      .order("trade_date", { ascending: false });

    if (error) throw error;

    // Get unique dates
    const uniqueDates = [...new Set((data || []).map((d) => d.trade_date))];
    return uniqueDates.filter(Boolean) as string[];
  }

  /**
   * Get unique file names for filtering
   */
  async getAvailableFileNames(): Promise<string[]> {
    const { data, error } = await supabase
      .from("trade_history")
      .select("file_name")
      .not("file_name", "is", null)
      .order("file_name", { ascending: true });

    if (error) throw error;

    const uniqueNames = [...new Set((data || []).map((d) => d.file_name))];
    return uniqueNames.filter(Boolean) as string[];
  }

  /**
   * Get trade sums by client for a date range
   */
  async getTradeSums(fromDate: string, toDate: string): Promise<TradeSums[]> {
    const { data, error } = await supabase.rpc("get_accounting_trade_sums", {
      _from_trade_date: fromDate,
      _to_trade_date: toDate,
    });

    if (error) throw error;

    return (data as TradeSums[]) || [];
  }

  /**
   * Bulk insert trades with progress tracking
   */
  async bulkInsertTrades(
    trades: TradeHistoryInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    return this.bulkInsert(trades as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
  }

  /**
   * Delete trades by file name
   */
  async deleteByFileName(fileName: string): Promise<number> {
    const { data, error } = await supabase
      .from("trade_history")
      .delete()
      .eq("file_name", fileName)
      .select("id");

    if (error) throw error;

    return data?.length || 0;
  }
}

class DepositWithdrawalServiceClass extends BaseService<DepositWithdrawal> {
  protected tableName = "deposits_withdrawals";
  protected defaultSort = { column: "transaction_date", ascending: false };

  /**
   * Get deposits/withdrawals with filtering
   */
  async getDepositsWithdrawals(params?: {
    filters?: {
      type?: string;
      date?: string;
      search?: string;
      rmEmail?: string;
    };
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<DepositWithdrawal>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("deposits_withdrawals")
      .select("*", { count: "exact" })
      .range(from, to);

    if (params?.filters?.type) {
      query = query.eq("transaction_type", params.filters.type);
    }
    if (params?.filters?.date) {
      query = query.eq("transaction_date", params.filters.date);
    }
    if (params?.filters?.rmEmail) {
      query = query.eq("rm_email", params.filters.rmEmail);
    }

    const sort = params?.sort || this.defaultSort;
    if (sort) {
      query = query.order(sort.column, { ascending: sort.ascending ?? true });
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as DepositWithdrawal[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get deposit import statistics
   */
  async getImportStats(): Promise<DepositImportStats[]> {
    const { data, error } = await supabase.rpc("get_deposit_import_stats");

    if (error) throw error;

    return (data as DepositImportStats[]) || [];
  }

  /**
   * Get available transaction dates
   */
  async getAvailableDates(): Promise<string[]> {
    const { data, error } = await supabase
      .from("deposits_withdrawals")
      .select("transaction_date")
      .order("transaction_date", { ascending: false });

    if (error) throw error;

    const uniqueDates = [...new Set((data || []).map((d) => d.transaction_date))];
    return uniqueDates.filter(Boolean) as string[];
  }

  /**
   * Get deposit/withdrawal counts for a specific date
   */
  async getCountsByDate(date: string): Promise<{
    deposits: { count: number; amount: number };
    withdrawals: { count: number; amount: number };
  }> {
    const { data, error } = await supabase.rpc("get_deposit_withdrawal_counts", {
      p_date: date,
    });

    if (error) throw error;

    const result = {
      deposits: { count: 0, amount: 0 },
      withdrawals: { count: 0, amount: 0 },
    };

    (data || []).forEach((row: any) => {
      if (row.transaction_type === "Deposit") {
        result.deposits.count = row.count;
        result.deposits.amount = row.amount;
      } else if (row.transaction_type === "Withdrawal") {
        result.withdrawals.count = row.count;
        result.withdrawals.amount = row.amount;
      }
    });

    return result;
  }

  /**
   * Bulk insert deposits/withdrawals
   */
  async bulkInsertDeposits(
    records: DepositWithdrawalInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<{ success: number; failed: number; errors: string[]; total: number }> {
    return super.bulkInsert(records as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
  }
}

class AccountingServiceClass {
  /**
   * Get accounting data with filters
   */
  async getAccountingData(params?: {
    fromTradeDate?: string;
    toTradeDate?: string;
    fromTxDate?: string;
    toTxDate?: string;
    search?: string;
    pagination?: PaginationParams;
  }): Promise<AccountingDataRow[]> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 100;
    const offset = (page - 1) * pageSize;

    const { data, error } = await supabase.rpc("get_accounting_data", {
      _from_trade_date: params?.fromTradeDate || null,
      _to_trade_date: params?.toTradeDate || null,
      _from_tx_date: params?.fromTxDate || null,
      _to_tx_date: params?.toTxDate || null,
      _search: params?.search || null,
      _limit: pageSize,
      _offset: offset,
    });

    if (error) throw error;

    return (data as AccountingDataRow[]) || [];
  }

  /**
   * Get accounting summary
   */
  async getAccountingSummary(params?: {
    fromTradeDate?: string;
    toTradeDate?: string;
    fromTxDate?: string;
    toTxDate?: string;
    searchTerm?: string;
    accountTypeFilter?: string;
    hasTradesFilter?: string;
  }): Promise<AccountingSummary | null> {
    const { data, error } = await supabase.rpc("get_accounting_summary", {
      _from_trade_date: params?.fromTradeDate || null,
      _to_trade_date: params?.toTradeDate || null,
      _from_tx_date: params?.fromTxDate || null,
      _to_tx_date: params?.toTxDate || null,
      _search_term: params?.searchTerm || null,
      _account_type_filter: params?.accountTypeFilter || null,
      _has_trades_filter: params?.hasTradesFilter || null,
    });

    if (error) throw error;

    return data?.[0] as AccountingSummary | null;
  }

  /**
   * Get turnover by department
   */
  async getTurnoverByDepartment(params?: {
    fromTxDate?: string;
    toTxDate?: string;
  }): Promise<{ department: string; turnover: number; total_buy: number; total_sell: number }[]> {
    const { data, error } = await supabase.rpc("get_accounting_turnover_by_department", {
      _from_tx_date: params?.fromTxDate || null,
      _to_tx_date: params?.toTxDate || null,
    });

    if (error) throw error;

    return data || [];
  }

  /**
   * Get commission by department
   */
  async getCommissionByDepartment(params?: {
    fromTxDate?: string;
    toTxDate?: string;
  }): Promise<{ department: string; total_commission: number; total_turnover: number; trade_count: number }[]> {
    const { data, error } = await supabase.rpc("get_commission_by_department", {
      _from_tx_date: params?.fromTxDate || null,
      _to_tx_date: params?.toTxDate || null,
    });

    if (error) throw error;

    return data || [];
  }
}

// Export singleton instances
export const TradeService = new TradeServiceClass();
export const DepositWithdrawalService = new DepositWithdrawalServiceClass();
export const AccountingService = new AccountingServiceClass();
