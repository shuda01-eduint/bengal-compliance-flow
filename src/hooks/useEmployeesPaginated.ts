/**
 * Paginated employees hook using the EmployeeService
 * Replaces the basic useEmployees hook with pagination, filtering, and caching
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmployeeService } from "@/services";
import type {
  Employee,
  EmployeeInsert,
  EmployeeUpdate,
  EmployeeSalary,
  EmployeeSalaryInsert,
  EmployeeFilters,
  PaginationParams,
  SortParams,
  PaginatedResponse,
  BulkOperationResult,
} from "@/services/types";

// ============================================
// Employee List Hooks
// ============================================

interface UseEmployeesParams {
  filters?: EmployeeFilters;
  pagination?: PaginationParams;
  sort?: SortParams;
  enabled?: boolean;
}

/**
 * Paginated employees with filtering and sorting
 */
export function useEmployeesPaginated(params?: UseEmployeesParams) {
  return useQuery({
    queryKey: ["employees", "paginated", params?.filters, params?.pagination, params?.sort],
    queryFn: () => EmployeeService.getEmployees({
      filters: params?.filters,
      pagination: params?.pagination,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Infinite scroll for employees
 */
export function useEmployeesInfinite(params?: {
  filters?: EmployeeFilters;
  sort?: SortParams;
  pageSize?: number;
}) {
  return useInfiniteQuery({
    queryKey: ["employees", "infinite", params?.filters, params?.sort],
    queryFn: ({ pageParam = 1 }) => EmployeeService.getEmployees({
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
 * Fetch all employees (with internal pagination) - use sparingly
 */
export function useAllEmployees(params?: {
  filters?: EmployeeFilters;
  sort?: SortParams;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["employees", "all", params?.filters, params?.sort],
    queryFn: () => EmployeeService.getAllEmployees({
      filters: params?.filters,
      sort: params?.sort,
    }),
    enabled: params?.enabled !== false,
    staleTime: 10 * 60 * 1000, // 10 minutes - longer cache for full list
  });
}

/**
 * Get a single employee by employee_id
 */
export function useEmployee(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employees", "single", employeeId],
    queryFn: () => EmployeeService.getByEmployeeId(employeeId),
    enabled: enabled && !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get filter options (departments, branches, etc.)
 */
export function useEmployeeFilterOptions() {
  return useQuery({
    queryKey: ["employees", "filter-options"],
    queryFn: () => EmployeeService.getFilterOptions(),
    staleTime: 30 * 60 * 1000, // 30 minutes - rarely changes
  });
}

// ============================================
// Employee CRUD Mutations
// ============================================

export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (employee: EmployeeInsert) => EmployeeService.create(employee as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ employeeId, updates }: { employeeId: string; updates: EmployeeUpdate }) =>
      EmployeeService.updateByEmployeeId(employeeId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (employeeId: string) => EmployeeService.deleteByEmployeeId(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useBulkImportEmployees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { 
      employees: EmployeeInsert[]; 
      upsertOnConflict?: boolean;
    }) => EmployeeService.bulkImport(params.employees, { 
      upsertOnConflict: params.upsertOnConflict 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

// ============================================
// Salary Hooks
// ============================================

export function useEmployeeSalaries(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employees", "salaries", employeeId],
    queryFn: () => EmployeeService.getSalaries(employeeId),
    enabled: enabled && !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCurrentSalary(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employees", "current-salary", employeeId],
    queryFn: () => EmployeeService.getCurrentSalary(employeeId),
    enabled: enabled && !!employeeId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (salary: EmployeeSalaryInsert) => EmployeeService.addSalary(salary),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employees", "salaries", variables.employee_id] });
      queryClient.invalidateQueries({ queryKey: ["employees", "current-salary", variables.employee_id] });
    },
  });
}

export function useBulkImportSalaries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (salaries: EmployeeSalaryInsert[]) => EmployeeService.bulkImportSalaries(salaries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees", "salaries"] });
      queryClient.invalidateQueries({ queryKey: ["employees", "current-salary"] });
    },
  });
}

// ============================================
// Utility: Prefetch functions
// ============================================

export function usePrefetchEmployees() {
  const queryClient = useQueryClient();

  return {
    prefetchPage: (params: UseEmployeesParams) => {
      queryClient.prefetchQuery({
        queryKey: ["employees", "paginated", params.filters, params.pagination, params.sort],
        queryFn: () => EmployeeService.getEmployees({
          filters: params.filters,
          pagination: params.pagination,
          sort: params.sort,
        }),
        staleTime: 5 * 60 * 1000,
      });
    },
    prefetchFilterOptions: () => {
      queryClient.prefetchQuery({
        queryKey: ["employees", "filter-options"],
        queryFn: () => EmployeeService.getFilterOptions(),
        staleTime: 30 * 60 * 1000,
      });
    },
  };
}
