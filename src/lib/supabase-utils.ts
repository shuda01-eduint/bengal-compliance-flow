/**
 * Shared Supabase utilities for handling common patterns like pagination
 */

/**
 * Helper function to fetch all rows with pagination.
 * Supabase has a default limit of 1000 rows per query.
 * This function automatically paginates through all results.
 * 
 * @param queryFn - Function that takes (from, to) range and returns a Supabase query promise
 * @returns Promise resolving to array of all fetched rows
 * 
 * @example
 * const allClients = await fetchAllRows<Client>((from, to) =>
 *   supabase
 *     .from("clients")
 *     .select("*")
 *     .range(from, to)
 * );
 */
export async function fetchAllRows<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const result = await queryFn(from, to);
    const { data, error } = result;

    if (error) throw error;
    if (data) allData = [...allData, ...data];
    hasMore = data?.length === PAGE_SIZE;
    page++;
  }

  return allData;
}
