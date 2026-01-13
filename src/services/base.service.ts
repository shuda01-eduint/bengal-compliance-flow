/**
 * Abstract base service class with common CRUD and pagination functionality
 */

import { supabase } from "@/integrations/supabase/client";
import type { 
  PaginationParams, 
  PaginatedResponse, 
  SortParams, 
  ProgressCallback,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 1000;

export abstract class BaseService<T> {
  protected abstract tableName: string;
  protected defaultSort?: SortParams;

  /**
   * Fetch all rows with automatic pagination to bypass Supabase 1000-row limit.
   */
  protected async fetchAll(options?: {
    select?: string;
    sort?: SortParams;
    onProgress?: ProgressCallback;
  }): Promise<T[]> {
    const PAGE_SIZE = 1000;
    let allData: T[] = [];
    let page = 0;
    let hasMore = true;

    const sort = options?.sort || this.defaultSort;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from(this.tableName as any)
        .select(options?.select || "*", { count: "exact" })
        .range(from, to);

      if (sort) {
        query = query.order(sort.column, { ascending: sort.ascending ?? true });
      }

      const { data, error, count } = await query;

      if (error) throw error;

      if (data) {
        allData = [...allData, ...(data as unknown as T[])];
        options?.onProgress?.(allData.length, count || undefined);
      }

      hasMore = data?.length === PAGE_SIZE;
      page++;
    }

    return allData;
  }

  /**
   * Fetch paginated results with total count
   */
  protected async fetchPaginated(options?: {
    select?: string;
    sort?: SortParams;
    pagination?: PaginationParams;
  }): Promise<PaginatedResponse<T>> {
    const page = options?.pagination?.page ?? 1;
    const pageSize = Math.min(options?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from(this.tableName as any)
      .select(options?.select || "*", { count: "exact" })
      .range(from, to);

    const sort = options?.sort || this.defaultSort;
    if (sort) {
      query = query.order(sort.column, { ascending: sort.ascending ?? true });
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const totalCount = count || 0;
    const hasMore = from + (data?.length || 0) < totalCount;

    return {
      data: (data as unknown as T[]) || [],
      totalCount,
      hasMore,
      page,
      pageSize,
    };
  }

  /**
   * Count records
   */
  async count(): Promise<number> {
    const { count, error } = await supabase
      .from(this.tableName as any)
      .select("*", { count: "exact", head: true });

    if (error) throw error;

    return count || 0;
  }

  /**
   * Get a single record by ID
   */
  async getById(id: string, select?: string): Promise<T | null> {
    const { data, error } = await supabase
      .from(this.tableName as any)
      .select(select || "*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;

    return data as T | null;
  }

  /**
   * Create a new record
   */
  async create(record: Partial<T>): Promise<T> {
    const { data, error } = await supabase
      .from(this.tableName as any)
      .insert(record as any)
      .select()
      .single();

    if (error) throw error;

    return data as T;
  }

  /**
   * Update an existing record
   */
  async update(id: string, updates: Partial<T>): Promise<T> {
    const { data, error } = await supabase
      .from(this.tableName as any)
      .update(updates as any)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return data as T;
  }

  /**
   * Delete a record
   */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName as any)
      .delete()
      .eq("id", id);

    if (error) throw error;
  }

  /**
   * Upsert records (insert or update on conflict)
   */
  async upsert(records: Partial<T>[], options?: { 
    onConflict?: string;
    ignoreDuplicates?: boolean;
  }): Promise<T[]> {
    const { data, error } = await supabase
      .from(this.tableName as any)
      .upsert(records as any[], {
        onConflict: options?.onConflict,
        ignoreDuplicates: options?.ignoreDuplicates,
      })
      .select();

    if (error) throw error;

    return (data as unknown as T[]) || [];
  }

  /**
   * Bulk insert records with progress tracking
   */
  async bulkInsert(
    records: Partial<T>[],
    options?: {
      batchSize?: number;
      onProgress?: ProgressCallback;
    }
  ): Promise<{ success: number; failed: number; errors: string[]; total: number }> {
    const batchSize = options?.batchSize ?? 500;
    const total = records.length;
    const results = { success: 0, failed: 0, errors: [] as string[], total };

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      try {
        const { error } = await supabase
          .from(this.tableName as any)
          .insert(batch as any[]);

        if (error) {
          results.failed += batch.length;
          results.errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          results.success += batch.length;
        }
      } catch (err: any) {
        results.failed += batch.length;
        results.errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${err.message}`);
      }

      options?.onProgress?.(results.success + results.failed, total);
    }

    return results;
  }
}
