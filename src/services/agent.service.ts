/**
 * Agent Service - handles agents, agent codes, and trade details
 */

import { supabase } from "@/integrations/supabase/client";
import { BaseService } from "./base.service";
import type {
  Agent,
  AgentInsert,
  AgentUpdate,
  AgentCode,
  AgentCodeInsert,
  AgentTradeDetail,
  AgentTradeDetailInsert,
  AgentFilters,
  PaginationParams,
  PaginatedResponse,
  SortParams,
  ProgressCallback,
  BulkOperationResult,
} from "./types";

interface GroupedAgentCodes {
  [rmId: string]: {
    rmName: string;
    codes: AgentCode[];
  };
}

interface AgentSummary {
  agentId: string;
  agentName: string;
  totalClients: number;
  totalTurnover: number;
  totalCommission: number;
  status: string;
}

class AgentServiceClass extends BaseService<Agent> {
  protected tableName = "agents";
  protected defaultSort = { column: "agent_id", ascending: true };

  /**
   * Get agents with filtering and pagination
   */
  async getAgents(params?: {
    filters?: AgentFilters;
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<Agent>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("agents")
      .select("*", { count: "exact" })
      .range(from, to);

    // Apply filters
    if (params?.filters?.rmId) {
      query = query.eq("rm_id", params.filters.rmId);
    }
    if (params?.filters?.status) {
      query = query.eq("status", params.filters.status);
    }
    if (params?.filters?.search) {
      query = query.or(
        `name.ilike.%${params.filters.search}%,agent_id.ilike.%${params.filters.search}%`
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
      data: (data as Agent[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get all agents (handles pagination internally)
   */
  async getAllAgents(params?: {
    filters?: AgentFilters;
    sort?: SortParams;
    onProgress?: ProgressCallback;
  }): Promise<Agent[]> {
    const PAGE_SIZE = 1000;
    let allData: Agent[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("agents")
        .select("*", { count: "exact" })
        .range(from, to);

      if (params?.filters?.rmId) {
        query = query.eq("rm_id", params.filters.rmId);
      }
      if (params?.filters?.status) {
        query = query.eq("status", params.filters.status);
      }
      if (params?.filters?.search) {
        query = query.or(
          `name.ilike.%${params.filters.search}%,agent_id.ilike.%${params.filters.search}%`
        );
      }

      const sort = params?.sort || this.defaultSort;
      query = query.order(sort.column, { ascending: sort.ascending ?? true });

      const { data, error, count } = await query;

      if (error) throw error;

      if (data) {
        allData = [...allData, ...(data as Agent[])];
        params?.onProgress?.(allData.length, count || undefined);
      }

      hasMore = data?.length === PAGE_SIZE;
      page++;
    }

    return allData;
  }

  /**
   * Get agent by agent_id (not UUID id)
   */
  async getByAgentId(agentId: string): Promise<Agent | null> {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error) throw error;

    return data as Agent | null;
  }

  /**
   * Get all agent codes
   */
  async getAgentCodes(agentId?: string): Promise<AgentCode[]> {
    let query = supabase
      .from("agent_codes")
      .select("*")
      .order("investor_code", { ascending: true });

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data as AgentCode[]) || [];
  }

  /**
   * Get agent codes grouped by RM
   */
  async getAgentCodesByRM(rmId?: string): Promise<GroupedAgentCodes> {
    let query = supabase
      .from("agent_codes")
      .select("*")
      .order("rm_id", { ascending: true });

    if (rmId) {
      query = query.eq("rm_id", rmId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Group by RM
    const grouped: GroupedAgentCodes = {};
    
    (data || []).forEach((code) => {
      if (!grouped[code.rm_id]) {
        grouped[code.rm_id] = {
          rmName: code.rm_id, // We don't have rm_name in agent_codes, using rm_id
          codes: [],
        };
      }
      grouped[code.rm_id].codes.push(code as AgentCode);
    });

    return grouped;
  }

  /**
   * Get agent trade details
   */
  async getAgentTradeDetails(params?: {
    uploadMonth?: string;
    rmId?: string;
    agentId?: string;
    pagination?: PaginationParams;
  }): Promise<AgentTradeDetail[]> {
    let query = supabase
      .from("agent_trade_details")
      .select("*")
      .order("uploaded_at", { ascending: false });

    if (params?.uploadMonth) {
      query = query.eq("upload_month", params.uploadMonth);
    }
    if (params?.rmId) {
      query = query.eq("rm_id", params.rmId);
    }
    if (params?.agentId) {
      query = query.eq("agent_id", params.agentId);
    }

    // Apply pagination if provided
    if (params?.pagination) {
      const page = params.pagination.page ?? 1;
      const pageSize = params.pagination.pageSize ?? 100;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data as AgentTradeDetail[]) || [];
  }

  /**
   * Get available upload months for filtering
   */
  async getAvailableUploadMonths(): Promise<string[]> {
    const { data, error } = await supabase
      .from("agent_trade_details")
      .select("upload_month")
      .not("upload_month", "is", null)
      .order("upload_month", { ascending: false });

    if (error) throw error;

    const uniqueMonths = [...new Set((data || []).map((d) => d.upload_month))];
    return uniqueMonths.filter(Boolean) as string[];
  }

  /**
   * Get unique RMs for filtering
   */
  async getUniqueRMs(): Promise<{ rmId: string; rmName: string | null }[]> {
    const { data, error } = await supabase
      .from("agents")
      .select("rm_id, rm_name")
      .order("rm_id", { ascending: true });

    if (error) throw error;

    // Get unique RMs
    const rmMap = new Map<string, string | null>();
    (data || []).forEach((a) => {
      if (!rmMap.has(a.rm_id)) {
        rmMap.set(a.rm_id, a.rm_name);
      }
    });

    return Array.from(rmMap.entries()).map(([rmId, rmName]) => ({
      rmId,
      rmName,
    }));
  }

  /**
   * Get agent summary stats
   */
  async getAgentSummary(agentId: string): Promise<AgentSummary | null> {
    // Get agent info
    const agent = await this.getByAgentId(agentId);
    if (!agent) return null;

    // Get client count
    const { count: clientCount } = await supabase
      .from("agent_codes")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", agentId);

    // Get trade summary (latest month)
    const { data: tradeData } = await supabase
      .from("agent_trade_details")
      .select("turnover, gross_commission")
      .eq("agent_id", agentId);

    const totalTurnover = (tradeData || []).reduce((sum, t) => sum + (t.turnover || 0), 0);
    const totalCommission = (tradeData || []).reduce((sum, t) => sum + (t.gross_commission || 0), 0);

    return {
      agentId: agent.agent_id,
      agentName: agent.name,
      totalClients: clientCount || 0,
      totalTurnover,
      totalCommission,
      status: agent.status || "Active",
    };
  }

  /**
   * Bulk import agents
   */
  async bulkImport(
    agents: AgentInsert[],
    options?: {
      onProgress?: ProgressCallback;
      upsertOnConflict?: boolean;
    }
  ): Promise<BulkOperationResult> {
    if (options?.upsertOnConflict) {
      const result = await this.upsert(agents as any[], {
        onConflict: "agent_id",
      });
      return {
        success: result.length,
        failed: agents.length - result.length,
        errors: [],
        total: agents.length,
      };
    }

    const result = await this.bulkInsert(agents as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
    return { ...result, total: agents.length };
  }

  /**
   * Bulk import agent codes
   */
  async bulkImportCodes(
    codes: AgentCodeInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<BulkOperationResult> {
    const BATCH_SIZE = 500;
    const results: BulkOperationResult = { success: 0, failed: 0, errors: [], total: codes.length };

    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      const batch = codes.slice(i, i + BATCH_SIZE);

      try {
        const { error } = await supabase
          .from("agent_codes")
          .upsert(batch, { onConflict: "investor_code,agent_id" });

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

  /**
   * Bulk import agent trade details
   */
  async bulkImportTradeDetails(
    details: AgentTradeDetailInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<BulkOperationResult> {
    const BATCH_SIZE = 500;
    const results: BulkOperationResult = { success: 0, failed: 0, errors: [], total: details.length };

    for (let i = 0; i < details.length; i += BATCH_SIZE) {
      const batch = details.slice(i, i + BATCH_SIZE);

      try {
        const { error } = await supabase
          .from("agent_trade_details")
          .insert(batch);

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

  /**
   * Update agent by agent_id
   */
  async updateByAgentId(agentId: string, updates: AgentUpdate): Promise<Agent> {
    const { data, error } = await supabase
      .from("agents")
      .update(updates)
      .eq("agent_id", agentId)
      .select()
      .single();

    if (error) throw error;

    return data as Agent;
  }

  /**
   * Delete agent by agent_id
   */
  async deleteByAgentId(agentId: string): Promise<void> {
    const { error } = await supabase
      .from("agents")
      .delete()
      .eq("agent_id", agentId);

    if (error) throw error;
  }
}

// Export singleton instance
export const AgentService = new AgentServiceClass();
