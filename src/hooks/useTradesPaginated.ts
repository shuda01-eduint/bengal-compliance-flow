/**
 * Paginated trades hook using the TradeService
 * Replaces scattered trade fetching logic with a centralized, cached approach
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TradeService, DepositWithdrawalService, AccountingService } from "@/services";
import type {
  TradeFilters,
  PaginationParams,
  SortParams,
  TradeHistory,
  DepositWithdrawal,
  TradeFileStats,
  DepositImportStats,
  AccountingDataRow,
  AccountingSummary,
  TradeSums,
  PaginatedResponse,
} from "@/services/types";

// ============================================
// Trade History Hooks
// ============================================

interface UseTradesParams {
  filters?: TradeFilters;
  pagination?: PaginationParams;
  sort?: SortParams;
  enabled?: boolean;
}

export function useTradesPaginated(params?: UseTradesParams) {
  return useQuery({
    queryKey: ["trades", "paginated", params?.filters, params?.pagination, params?.sort],
    queryFn: () => TradeService.getAdminTrades({
      filters: params?.filters,
      pagination: params?.pagination,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useTradesInfinite(params?: {
  filters?: TradeFilters;
  sort?: SortParams;
  pageSize?: number;
}) {
  return useInfiniteQuery({
    queryKey: ["trades", "infinite", params?.filters, params?.sort],
    queryFn: ({ pageParam = 1 }) => TradeService.getAdminTrades({
      filters: params?.filters,
      pagination: { page: pageParam, pageSize: params?.pageSize ?? 50 },
      sort: params?.sort,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => 
      lastPage.hasMore ? allPages.length + 1 : undefined,
    staleTime: 2 * 60 * 1000,
  });
}

export function useTradeFileStats() {
  return useQuery({
    queryKey: ["trades", "file-stats"],
    queryFn: () => TradeService.getFileStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAvailableTradeDates() {
  return useQuery({
    queryKey: ["trades", "available-dates"],
    queryFn: () => TradeService.getAvailableTradeDates(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useAvailableFileNames() {
  return useQuery({
    queryKey: ["trades", "available-files"],
    queryFn: () => TradeService.getAvailableFileNames(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useTradeSums(fromDate: string, toDate: string, enabled = true) {
  return useQuery({
    queryKey: ["trades", "sums", fromDate, toDate],
    queryFn: () => TradeService.getTradeSums(fromDate, toDate),
    enabled: enabled && !!fromDate && !!toDate,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBulkInsertTrades() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (trades: Parameters<typeof TradeService.bulkInsertTrades>[0]) =>
      TradeService.bulkInsertTrades(trades),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

export function useDeleteTradesByFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fileName: string) => TradeService.deleteByFileName(fileName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

// ============================================
// Deposits/Withdrawals Hooks
// ============================================

interface UseDepositsParams {
  filters?: {
    type?: string;
    date?: string;
    search?: string;
    rmEmail?: string;
  };
  pagination?: PaginationParams;
  sort?: SortParams;
  enabled?: boolean;
}

export function useDepositsPaginated(params?: UseDepositsParams) {
  return useQuery({
    queryKey: ["deposits", "paginated", params?.filters, params?.pagination, params?.sort],
    queryFn: () => DepositWithdrawalService.getDepositsWithdrawals({
      filters: params?.filters,
      pagination: params?.pagination,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDepositsInfinite(params?: {
  filters?: UseDepositsParams["filters"];
  sort?: SortParams;
  pageSize?: number;
}) {
  return useInfiniteQuery({
    queryKey: ["deposits", "infinite", params?.filters, params?.sort],
    queryFn: ({ pageParam = 1 }) => DepositWithdrawalService.getDepositsWithdrawals({
      filters: params?.filters,
      pagination: { page: pageParam, pageSize: params?.pageSize ?? 50 },
      sort: params?.sort,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? (lastPage.page ?? 0) + 1 : undefined,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDepositImportStats() {
  return useQuery({
    queryKey: ["deposits", "import-stats"],
    queryFn: () => DepositWithdrawalService.getImportStats(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAvailableDepositDates() {
  return useQuery({
    queryKey: ["deposits", "available-dates"],
    queryFn: () => DepositWithdrawalService.getAvailableDates(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useDepositCountsByDate(date: string, enabled = true) {
  return useQuery({
    queryKey: ["deposits", "counts", date],
    queryFn: () => DepositWithdrawalService.getCountsByDate(date),
    enabled: enabled && !!date,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBulkInsertDeposits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (records: Parameters<typeof DepositWithdrawalService.bulkInsertDeposits>[0]) =>
      DepositWithdrawalService.bulkInsertDeposits(records),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
    },
  });
}

// ============================================
// Accounting Hooks
// ============================================

interface UseAccountingParams {
  fromTradeDate?: string;
  toTradeDate?: string;
  fromTxDate?: string;
  toTxDate?: string;
  search?: string;
  pagination?: PaginationParams;
  enabled?: boolean;
}

export function useAccountingData(params?: UseAccountingParams) {
  return useQuery({
    queryKey: ["accounting", "data", params],
    queryFn: () => AccountingService.getAccountingData({
      fromTradeDate: params?.fromTradeDate,
      toTradeDate: params?.toTradeDate,
      fromTxDate: params?.fromTxDate,
      toTxDate: params?.toTxDate,
      search: params?.search,
      pagination: params?.pagination,
    }),
    enabled: params?.enabled !== false,
    staleTime: 2 * 60 * 1000,
  });
}

interface UseAccountingSummaryParams {
  fromTradeDate?: string;
  toTradeDate?: string;
  fromTxDate?: string;
  toTxDate?: string;
  searchTerm?: string;
  accountTypeFilter?: string;
  hasTradesFilter?: string;
  enabled?: boolean;
}

export function useAccountingSummary(params?: UseAccountingSummaryParams) {
  return useQuery({
    queryKey: ["accounting", "summary", params],
    queryFn: () => AccountingService.getAccountingSummary({
      fromTradeDate: params?.fromTradeDate,
      toTradeDate: params?.toTradeDate,
      fromTxDate: params?.fromTxDate,
      toTxDate: params?.toTxDate,
      searchTerm: params?.searchTerm,
      accountTypeFilter: params?.accountTypeFilter,
      hasTradesFilter: params?.hasTradesFilter,
    }),
    enabled: params?.enabled !== false,
    staleTime: 2 * 60 * 1000,
  });
}

export function useTurnoverByDepartment(params?: {
  fromTxDate?: string;
  toTxDate?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["accounting", "turnover-by-dept", params?.fromTxDate, params?.toTxDate],
    queryFn: () => AccountingService.getTurnoverByDepartment({
      fromTxDate: params?.fromTxDate,
      toTxDate: params?.toTxDate,
    }),
    enabled: params?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCommissionByDepartment(params?: {
  fromTxDate?: string;
  toTxDate?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["accounting", "commission-by-dept", params?.fromTxDate, params?.toTxDate],
    queryFn: () => AccountingService.getCommissionByDepartment({
      fromTxDate: params?.fromTxDate,
      toTxDate: params?.toTxDate,
    }),
    enabled: params?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Utility: Prefetch functions
// ============================================

export function usePrefetchTrades() {
  const queryClient = useQueryClient();

  return {
    prefetchPage: (params: UseTradesParams) => {
      queryClient.prefetchQuery({
        queryKey: ["trades", "paginated", params.filters, params.pagination, params.sort],
        queryFn: () => TradeService.getAdminTrades({
          filters: params.filters,
          pagination: params.pagination,
          sort: params.sort,
        }),
        staleTime: 2 * 60 * 1000,
      });
    },
  };
}
