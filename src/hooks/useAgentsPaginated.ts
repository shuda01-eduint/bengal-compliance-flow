/**
 * Paginated agents hook using the AgentService
 * Replaces the basic useAgents hook with pagination, filtering, and caching
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AgentService } from "@/services";
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
  SortParams,
  PaginatedResponse,
  BulkOperationResult,
} from "@/services/types";

// ============================================
// Agent List Hooks
// ============================================

interface UseAgentsParams {
  filters?: AgentFilters;
  pagination?: PaginationParams;
  sort?: SortParams;
  enabled?: boolean;
}

/**
 * Paginated agents with filtering and sorting
 */
export function useAgentsPaginated(params?: UseAgentsParams) {
  return useQuery({
    queryKey: ["agents", "paginated", params?.filters, params?.pagination, params?.sort],
    queryFn: () => AgentService.getAgents({
      filters: params?.filters,
      pagination: params?.pagination,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Infinite scroll for agents
 */
export function useAgentsInfinite(params?: {
  filters?: AgentFilters;
  sort?: SortParams;
  pageSize?: number;
}) {
  return useInfiniteQuery({
    queryKey: ["agents", "infinite", params?.filters, params?.sort],
    queryFn: ({ pageParam = 1 }) => AgentService.getAgents({
      filters: params?.filters,
      pagination: { page: pageParam, pageSize: params?.pageSize ?? 50 },
      sort: params?.sort,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? (lastPage.page ?? 0) + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch all agents (with internal pagination) - use sparingly
 */
export function useAllAgents(params?: {
  filters?: AgentFilters;
  sort?: SortParams;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["agents", "all", params?.filters, params?.sort],
    queryFn: () => AgentService.getAllAgents({
      filters: params?.filters,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Get a single agent by agent_id
 */
export function useAgent(agentId: string, enabled = true) {
  return useQuery({
    queryKey: ["agents", "single", agentId],
    queryFn: () => AgentService.getByAgentId(agentId),
    enabled: enabled && !!agentId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get agent summary stats
 */
export function useAgentSummary(agentId: string, enabled = true) {
  return useQuery({
    queryKey: ["agents", "summary", agentId],
    queryFn: () => AgentService.getAgentSummary(agentId),
    enabled: enabled && !!agentId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get unique RMs for filtering
 */
export function useUniqueRMs() {
  return useQuery({
    queryKey: ["agents", "unique-rms"],
    queryFn: () => AgentService.getUniqueRMs(),
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}

// ============================================
// Agent CRUD Mutations
// ============================================

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agent: AgentInsert) => AgentService.create(agent as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, updates }: { agentId: string; updates: AgentUpdate }) =>
      AgentService.updateByAgentId(agentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) => AgentService.deleteByAgentId(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useBulkImportAgents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { 
      agents: AgentInsert[]; 
      upsertOnConflict?: boolean;
    }) => AgentService.bulkImport(params.agents, { 
      upsertOnConflict: params.upsertOnConflict 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

// ============================================
// Agent Codes Hooks
// ============================================

export function useAgentCodes(agentId?: string) {
  return useQuery({
    queryKey: ["agents", "codes", agentId],
    queryFn: () => AgentService.getAgentCodes(agentId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgentCodesByRM(rmId?: string) {
  return useQuery({
    queryKey: ["agents", "codes-by-rm", rmId],
    queryFn: () => AgentService.getAgentCodesByRM(rmId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useBulkImportAgentCodes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (codes: AgentCodeInsert[]) => AgentService.bulkImportCodes(codes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "codes"] });
    },
  });
}

// ============================================
// Agent Trade Details Hooks
// ============================================

interface UseAgentTradeDetailsParams {
  uploadMonth?: string;
  rmId?: string;
  agentId?: string;
  pagination?: PaginationParams;
  enabled?: boolean;
}

export function useAgentTradeDetails(params?: UseAgentTradeDetailsParams) {
  return useQuery({
    queryKey: ["agents", "trade-details", params?.uploadMonth, params?.rmId, params?.agentId],
    queryFn: () => AgentService.getAgentTradeDetails({
      uploadMonth: params?.uploadMonth,
      rmId: params?.rmId,
      agentId: params?.agentId,
      pagination: params?.pagination,
    }),
    enabled: params?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAvailableUploadMonths() {
  return useQuery({
    queryKey: ["agents", "upload-months"],
    queryFn: () => AgentService.getAvailableUploadMonths(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useBulkImportAgentTradeDetails() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (details: AgentTradeDetailInsert[]) => AgentService.bulkImportTradeDetails(details),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "trade-details"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "upload-months"] });
    },
  });
}

// ============================================
// Utility: Prefetch functions
// ============================================

export function usePrefetchAgents() {
  const queryClient = useQueryClient();

  return {
    prefetchPage: (params: UseAgentsParams) => {
      queryClient.prefetchQuery({
        queryKey: ["agents", "paginated", params.filters, params.pagination, params.sort],
        queryFn: () => AgentService.getAgents({
          filters: params.filters,
          pagination: params.pagination,
          sort: params.sort,
        }),
        staleTime: 5 * 60 * 1000,
      });
    },
    prefetchUniqueRMs: () => {
      queryClient.prefetchQuery({
        queryKey: ["agents", "unique-rms"],
        queryFn: () => AgentService.getUniqueRMs(),
        staleTime: 30 * 60 * 1000,
      });
    },
  };
}
