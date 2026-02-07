
# Fix: EOD History Table Not Showing Feb 3rd Data

## Problem Identified
The EOD history table is not updating after processing trades for Feb 3rd. Investigation reveals:

1. The database **does** contain the Feb 3rd EOD record (verified via SQL query)
2. The API **is** returning Feb 3rd in the response (visible in network logs as 2nd entry)
3. The EOD Summary cards **are** showing the correct data from Feb 3rd
4. The issue is a **React Query caching problem** - the table component is showing stale cached data

The `invalidateQueries` call after `handleProcessStaged` isn't forcing a proper refetch in the EodLogTable component.

## Root Cause
The EodLogTable component uses React Query with default caching behavior. When `invalidateQueries` is called from EodPage, the query is marked as stale but may not immediately refetch if the component doesn't re-render or if there's a timing issue.

## Solution

### 1. Force Immediate Refetch in EodLogTable
Add `refetchOnWindowFocus: true` and reduce `staleTime` to ensure fresh data:

**File:** `src/components/eod/EodLogTable.tsx`
```typescript
const { data: history, isLoading } = useQuery({
  queryKey: ["eod-run-history", limit],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("eod_run_history")
      .select("*")
      .order("run_date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data as EodRunHistory[];
  },
  staleTime: 0,            // Always consider data stale
  refetchOnWindowFocus: true,
  refetchOnMount: "always" // Force refetch when component mounts
});
```

### 2. Ensure Proper Query Invalidation in EodPage
Use `refetchQueries` instead of `invalidateQueries` to force an immediate refetch:

**File:** `src/pages/EodPage.tsx`
```typescript
// In handleProcessStaged, after success:
if (result.success) {
  toast.success(`Processed trades for ${dateStr}`, {
    description: `${result.snapshots_created?.toLocaleString()} snapshots, ${result.positions_captured?.toLocaleString()} positions`,
  });
  setShowSummary(true);
  // Force immediate refetch instead of just invalidating
  await queryClient.refetchQueries({ queryKey: ["eod-run-history"] });
}
```

## Changes Summary

| File | Change |
|------|--------|
| `src/components/eod/EodLogTable.tsx` | Add `staleTime: 0`, `refetchOnMount: "always"` to ensure fresh data |
| `src/pages/EodPage.tsx` | Change `invalidateQueries` to `refetchQueries` for immediate update |

## Technical Details
- `staleTime: 0` - Data is considered stale immediately, triggering refetch checks
- `refetchOnMount: "always"` - Forces refetch every time the component mounts, not just when data is stale
- `refetchQueries` - Immediately fetches new data instead of just marking as stale
- These changes ensure the table always shows the latest EOD run history after processing
