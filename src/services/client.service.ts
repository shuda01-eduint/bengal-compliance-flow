/**
 * Client Service - handles clients, investors, balances, and holdings
 */

import { supabase } from "@/integrations/supabase/client";
import { BaseService } from "./base.service";
import type {
  Client,
  ClientInsert,
  Investor,
  InvestorInsert,
  InvestorUpdate,
  Holding,
  HoldingInsert,
  BalanceRaw,
  InvestorRmAssignment,
  InvestorAgentAssignment,
  ClientFilters,
  InvestorFilters,
  BalanceFilters,
  PaginationParams,
  PaginatedResponse,
  SortParams,
  ProgressCallback,
  BulkOperationResult,
  AdminBalanceRow,
  BalancesSummary,
  NegativeBalanceRow,
} from "./types";

class ClientServiceClass extends BaseService<Client> {
  protected tableName = "clients";
  protected defaultSort = { column: "inv_code", ascending: true };

  /**
   * Get clients with filtering and pagination
   */
  async getClients(params?: {
    filters?: ClientFilters;
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<Client>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("clients")
      .select("*", { count: "exact" })
      .range(from, to);

    // Apply filters
    if (params?.filters?.rmName) {
      query = query.eq("rm_name", params.filters.rmName);
    }
    if (params?.filters?.status) {
      query = query.eq("status", params.filters.status);
    }
    if (params?.filters?.search) {
      query = query.or(
        `inv_code.ilike.%${params.filters.search}%,investor_name.ilike.%${params.filters.search}%`
      );
    }
    if (params?.filters?.hasNegativeBalance) {
      query = query.lt("ledger_balance", 0);
    }

    // Apply sorting
    const sort = params?.sort || this.defaultSort;
    query = query.order(sort.column, { ascending: sort.ascending ?? true });

    const { data, error, count } = await query;

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as Client[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get all clients (handles pagination internally)
   */
  async getAllClients(params?: {
    filters?: ClientFilters;
    sort?: SortParams;
    onProgress?: ProgressCallback;
  }): Promise<Client[]> {
    const PAGE_SIZE = 1000;
    let allData: Client[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("clients")
        .select("*", { count: "exact" })
        .range(from, to);

      if (params?.filters?.rmName) {
        query = query.eq("rm_name", params.filters.rmName);
      }
      if (params?.filters?.status) {
        query = query.eq("status", params.filters.status);
      }
      if (params?.filters?.search) {
        query = query.or(
          `inv_code.ilike.%${params.filters.search}%,investor_name.ilike.%${params.filters.search}%`
        );
      }

      const sort = params?.sort || this.defaultSort;
      query = query.order(sort.column, { ascending: sort.ascending ?? true });

      const { data, error, count } = await query;

      if (error) throw error;

      if (data) {
        allData = [...allData, ...(data as Client[])];
        params?.onProgress?.(allData.length, count || undefined);
      }

      hasMore = data?.length === PAGE_SIZE;
      page++;
    }

    return allData;
  }

  /**
   * Bulk import clients
   */
  async bulkImport(
    clients: ClientInsert[],
    options?: { 
      onProgress?: ProgressCallback;
      upsertOnConflict?: boolean;
    }
  ): Promise<BulkOperationResult> {
    if (options?.upsertOnConflict) {
      const result = await this.upsert(clients as any[], {
        onConflict: "inv_code",
      });
      return {
        success: result.length,
        failed: clients.length - result.length,
        errors: [],
        total: clients.length,
      };
    }

    return this.bulkInsert(clients as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
  }
}

class InvestorServiceClass extends BaseService<Investor> {
  protected tableName = "investors";
  protected defaultSort = { column: "investor_code", ascending: true };

  /**
   * Get investors with filtering and pagination
   */
  async getInvestors(params?: {
    filters?: InvestorFilters;
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<Investor>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("investors")
      .select("*", { count: "exact" })
      .range(from, to);

    // Apply filters
    if (params?.filters?.accountType) {
      query = query.eq("account_type", params.filters.accountType);
    }
    if (params?.filters?.investorType) {
      query = query.eq("investor_type", params.filters.investorType);
    }
    if (params?.filters?.status) {
      query = query.eq("status", params.filters.status);
    }
    if (params?.filters?.search) {
      query = query.or(
        `investor_code.ilike.%${params.filters.search}%,investor_name.ilike.%${params.filters.search}%`
      );
    }

    // Apply sorting
    const sort = params?.sort || this.defaultSort;
    query = query.order(sort.column, { ascending: sort.ascending ?? true });

    const { data, error, count } = await query;

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as Investor[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get investor by investor_code
   */
  async getByInvestorCode(investorCode: string): Promise<Investor | null> {
    const { data, error } = await supabase
      .from("investors")
      .select("*")
      .eq("investor_code", investorCode)
      .maybeSingle();

    if (error) throw error;

    return data as Investor | null;
  }

  /**
   * Get filter options
   */
  async getFilterOptions(): Promise<{
    accountTypes: string[];
    investorTypes: string[];
    statuses: string[];
  }> {
    const { data, error } = await supabase.rpc("get_investor_filter_options");

    if (error) throw error;

    const result = (data as any)?.[0] || {};
    return {
      accountTypes: (result.account_types as string[]) || [],
      investorTypes: (result.investor_types as string[]) || [],
      statuses: (result.statuses as string[]) || [],
    };
  }

  /**
   * Get RM assignments for an investor
   */
  async getRmAssignments(investorCode: string): Promise<InvestorRmAssignment[]> {
    const { data, error } = await supabase
      .from("investor_rm_assignments")
      .select("*")
      .eq("investor_code", investorCode)
      .order("percentage", { ascending: false });

    if (error) throw error;

    return (data as InvestorRmAssignment[]) || [];
  }

  /**
   * Get agent assignments for an investor
   */
  async getAgentAssignments(investorCode: string): Promise<InvestorAgentAssignment[]> {
    const { data, error } = await supabase
      .from("investor_agent_assignments")
      .select("*")
      .eq("investor_code", investorCode)
      .order("percentage", { ascending: false });

    if (error) throw error;

    return (data as InvestorAgentAssignment[]) || [];
  }

  /**
   * Bulk import investors
   */
  async bulkImport(
    investors: InvestorInsert[],
    options?: {
      onProgress?: ProgressCallback;
      upsertOnConflict?: boolean;
    }
  ): Promise<BulkOperationResult> {
    if (options?.upsertOnConflict) {
      const result = await this.upsert(investors as any[], {
        onConflict: "investor_code",
      });
      return {
        success: result.length,
        failed: investors.length - result.length,
        errors: [],
        total: investors.length,
      };
    }

    return this.bulkInsert(investors as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
  }
}

class BalanceServiceClass {
  /**
   * Get admin balances using the optimized RPC function
   */
  async getAdminBalances(params: BalanceFilters & {
    limit?: number;
  }): Promise<AdminBalanceRow[]> {
    const { data, error } = await supabase.rpc("get_admin_balances_enriched", {
      p_date: params.date,
      p_rm_email: params.rmEmail || null,
      p_cursor_id: params.cursorId || null,
      p_limit: params.limit || 100,
    });

    if (error) throw error;

    return (data as AdminBalanceRow[]) || [];
  }

  /**
   * Get balances summary
   */
  async getBalancesSummary(date: string, rmEmail?: string): Promise<BalancesSummary | null> {
    const { data, error } = await supabase.rpc("get_admin_balances_summary", {
      p_date: date,
      p_rm_email: rmEmail || null,
    });

    if (error) throw error;

    return data?.[0] as BalancesSummary | null;
  }

  /**
   * Get available balance dates
   */
  async getAvailableDates(): Promise<string[]> {
    const { data, error } = await supabase.rpc("get_balance_dates");

    if (error) throw error;

    return (data || []).map((d: any) => d.as_of_date);
  }

  /**
   * Get available RMs for balance filtering
   */
  async getAvailableRMs(): Promise<{ rmEmail: string; rmName: string }[]> {
    const { data, error } = await supabase.rpc("get_balance_rms");

    if (error) throw error;

    return (data || []).map((d: any) => ({
      rmEmail: d.rm_email,
      rmName: d.rm_name,
    }));
  }

  /**
   * Get negative balance codes
   */
  async getNegativeBalances(params?: {
    fromDate?: string;
    toDate?: string;
    search?: string;
  }): Promise<NegativeBalanceRow[]> {
    const { data, error } = await supabase.rpc("get_negative_balance_codes", {
      p_from_date: params?.fromDate || null,
      p_to_date: params?.toDate || null,
      p_search: params?.search || null,
    });

    if (error) throw error;

    return (data as NegativeBalanceRow[]) || [];
  }

  /**
   * Get raw balance data
   */
  async getRawBalances(params?: {
    date?: string;
    investorCode?: string;
    rmEmail?: string;
    pagination?: PaginationParams;
  }): Promise<PaginatedResponse<BalanceRaw>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 100;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("balances_raw")
      .select("*", { count: "exact" })
      .range(from, to);

    if (params?.date) {
      query = query.eq("as_of_date", params.date);
    }
    if (params?.investorCode) {
      query = query.eq("investor_code", params.investorCode);
    }
    if (params?.rmEmail) {
      query = query.eq("rm_email", params.rmEmail);
    }

    query = query.order("investor_code", { ascending: true });

    const { data, error, count } = await query;

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as BalanceRaw[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }
}

class HoldingServiceClass extends BaseService<Holding> {
  protected tableName = "holdings";
  protected defaultSort = { column: "investor_code", ascending: true };

  /**
   * Get holdings for an investor
   */
  async getByInvestorCode(investorCode: string): Promise<Holding[]> {
    const { data, error } = await supabase
      .from("holdings")
      .select("*")
      .eq("investor_code", investorCode)
      .order("trading_code", { ascending: true });

    if (error) throw error;

    return (data as Holding[]) || [];
  }

  /**
   * Get holdings by trading code (security)
   */
  async getByTradingCode(tradingCode: string, pagination?: PaginationParams): Promise<PaginatedResponse<Holding>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 100;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from("holdings")
      .select("*", { count: "exact" })
      .eq("trading_code", tradingCode)
      .order("total_stock", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as Holding[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get unique trading codes
   */
  async getUniqueTradingCodes(): Promise<string[]> {
    const { data, error } = await supabase
      .from("holdings")
      .select("trading_code")
      .order("trading_code", { ascending: true });

    if (error) throw error;

    const uniqueCodes = [...new Set((data || []).map((h) => h.trading_code))];
    return uniqueCodes.filter(Boolean);
  }

  /**
   * Bulk import holdings
   */
  async bulkImport(
    holdings: HoldingInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<BulkOperationResult> {
    const BATCH_SIZE = 500;
    const results: BulkOperationResult = { success: 0, failed: 0, errors: [], total: holdings.length };

    for (let i = 0; i < holdings.length; i += BATCH_SIZE) {
      const batch = holdings.slice(i, i + BATCH_SIZE);

      try {
        const { error } = await supabase
          .from("holdings")
          .upsert(batch, { onConflict: "investor_code,trading_code" });

        if (error) {
          results.failed += batch.length;
          results.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
        } else {
          results.success += batch.length;
        }
      } catch (err: any) {
        results.failed += batch.length;
        results.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
      }

      options?.onProgress?.(results.success + results.failed, results.total);
    }

    return results;
  }
}

// Export singleton instances
export const ClientService = new ClientServiceClass();
export const InvestorService = new InvestorServiceClass();
export const BalanceService = new BalanceServiceClass();
export const HoldingService = new HoldingServiceClass();
