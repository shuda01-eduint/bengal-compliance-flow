/**
 * Employee Service - handles employee CRUD, salaries, and filtering
 */

import { supabase } from "@/integrations/supabase/client";
import { BaseService } from "./base.service";
import type {
  Employee,
  EmployeeInsert,
  EmployeeUpdate,
  EmployeeSalary,
  EmployeeSalaryInsert,
  EmployeeFilters,
  PaginationParams,
  PaginatedResponse,
  SortParams,
  ProgressCallback,
  BulkOperationResult,
} from "./types";

class EmployeeServiceClass extends BaseService<Employee> {
  protected tableName = "employees";
  protected defaultSort = { column: "employee_id", ascending: true };

  /**
   * Get employees with filtering and pagination
   */
  async getEmployees(params?: {
    filters?: EmployeeFilters;
    pagination?: PaginationParams;
    sort?: SortParams;
  }): Promise<PaginatedResponse<Employee>> {
    const page = params?.pagination?.page ?? 1;
    const pageSize = params?.pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("employees")
      .select("*", { count: "exact" })
      .range(from, to);

    // Apply filters
    if (params?.filters?.department) {
      query = query.eq("department", params.filters.department);
    }
    if (params?.filters?.branch) {
      query = query.eq("branch", params.filters.branch);
    }
    if (params?.filters?.status) {
      query = query.eq("status", params.filters.status);
    }
    if (params?.filters?.designation) {
      query = query.eq("designation", params.filters.designation);
    }
    if (params?.filters?.search) {
      query = query.or(
        `name.ilike.%${params.filters.search}%,employee_id.ilike.%${params.filters.search}%,email.ilike.%${params.filters.search}%`
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
      data: (data as Employee[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Get all employees (with pagination handling internally)
   */
  async getAllEmployees(params?: {
    filters?: EmployeeFilters;
    sort?: SortParams;
    onProgress?: ProgressCallback;
  }): Promise<Employee[]> {
    const PAGE_SIZE = 1000;
    let allData: Employee[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("employees")
        .select("*", { count: "exact" })
        .range(from, to);

      // Apply filters
      if (params?.filters?.department) {
        query = query.eq("department", params.filters.department);
      }
      if (params?.filters?.branch) {
        query = query.eq("branch", params.filters.branch);
      }
      if (params?.filters?.status) {
        query = query.eq("status", params.filters.status);
      }
      if (params?.filters?.search) {
        query = query.or(
          `name.ilike.%${params.filters.search}%,employee_id.ilike.%${params.filters.search}%`
        );
      }

      // Apply sorting
      const sort = params?.sort || this.defaultSort;
      query = query.order(sort.column, { ascending: sort.ascending ?? true });

      const { data, error, count } = await query;

      if (error) throw error;

      if (data) {
        allData = [...allData, ...(data as Employee[])];
        params?.onProgress?.(allData.length, count || undefined);
      }

      hasMore = data?.length === PAGE_SIZE;
      page++;
    }

    return allData;
  }

  /**
   * Get employee by employee_id (not UUID id)
   */
  async getByEmployeeId(employeeId: string): Promise<Employee | null> {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("employee_id", employeeId)
      .maybeSingle();

    if (error) throw error;

    return data as Employee | null;
  }

  /**
   * Get unique filter options from existing data
   */
  async getFilterOptions(): Promise<{
    departments: string[];
    branches: string[];
    designations: string[];
    statuses: string[];
  }> {
    const { data, error } = await supabase
      .from("employees")
      .select("department, branch, designation, status");

    if (error) throw error;

    const departments = [...new Set((data || []).map((e) => e.department).filter(Boolean))].sort();
    const branches = [...new Set((data || []).map((e) => e.branch).filter(Boolean))].sort();
    const designations = [...new Set((data || []).map((e) => e.designation).filter(Boolean))].sort();
    const statuses = [...new Set((data || []).map((e) => e.status).filter(Boolean))].sort();

    return { departments, branches, designations, statuses };
  }

  /**
   * Get employee salaries
   */
  async getSalaries(employeeId: string): Promise<EmployeeSalary[]> {
    const { data, error } = await supabase
      .from("employee_salaries")
      .select("*")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });

    if (error) throw error;

    return (data as EmployeeSalary[]) || [];
  }

  /**
   * Get current salary for an employee
   */
  async getCurrentSalary(employeeId: string): Promise<EmployeeSalary | null> {
    const { data, error } = await supabase
      .from("employee_salaries")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("is_current", true)
      .maybeSingle();

    if (error) throw error;

    return data as EmployeeSalary | null;
  }

  /**
   * Add salary record
   */
  async addSalary(salary: EmployeeSalaryInsert): Promise<EmployeeSalary> {
    // First, set all existing salaries for this employee to not current
    await supabase
      .from("employee_salaries")
      .update({ is_current: false })
      .eq("employee_id", salary.employee_id);

    // Insert new salary as current
    const { data, error } = await supabase
      .from("employee_salaries")
      .insert({ ...salary, is_current: true })
      .select()
      .single();

    if (error) throw error;

    return data as EmployeeSalary;
  }

  /**
   * Bulk import employees
   */
  async bulkImport(
    employees: EmployeeInsert[],
    options?: { 
      onProgress?: ProgressCallback;
      upsertOnConflict?: boolean;
    }
  ): Promise<BulkOperationResult> {
    if (options?.upsertOnConflict) {
      const result = await this.upsert(employees as any[], {
        onConflict: "employee_id",
      });
      return {
        success: result.length,
        failed: employees.length - result.length,
        errors: [],
        total: employees.length,
      };
    }

    return this.bulkInsert(employees as any[], {
      batchSize: 500,
      onProgress: options?.onProgress,
    });
  }

  /**
   * Bulk import salaries
   */
  async bulkImportSalaries(
    salaries: EmployeeSalaryInsert[],
    options?: { onProgress?: ProgressCallback }
  ): Promise<BulkOperationResult> {
    const BATCH_SIZE = 500;
    const results: BulkOperationResult = { success: 0, failed: 0, errors: [], total: salaries.length };

    for (let i = 0; i < salaries.length; i += BATCH_SIZE) {
      const batch = salaries.slice(i, i + BATCH_SIZE);

      try {
        const { error } = await supabase
          .from("employee_salaries")
          .upsert(batch, { onConflict: "employee_id,effective_from" });

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
   * Update employee by employee_id
   */
  async updateByEmployeeId(employeeId: string, updates: EmployeeUpdate): Promise<Employee> {
    const { data, error } = await supabase
      .from("employees")
      .update(updates)
      .eq("employee_id", employeeId)
      .select()
      .single();

    if (error) throw error;

    return data as Employee;
  }

  /**
   * Delete employee by employee_id
   */
  async deleteByEmployeeId(employeeId: string): Promise<void> {
    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("employee_id", employeeId);

    if (error) throw error;
  }
}

// Export singleton instance
export const EmployeeService = new EmployeeServiceClass();
