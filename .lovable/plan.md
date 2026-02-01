
# Optimize Admin Balance Import Performance

## Problem
The current Admin Balance import is extremely slow because it performs individual database updates for each investor's ledger_balance (23,961 individual HTTP requests). This takes 15-30 minutes for a file with 81,000+ rows.

## Solution Overview
Implement a bulk update RPC function for investor baseline balances and use batch processing for all operations, reducing import time from ~30 minutes to under 3 minutes.

## Implementation Details

### Step 1: Create Bulk Update RPC Function
Create a new PostgreSQL function `update_investor_balances_bulk` that accepts a JSONB array and updates all investors in a single database operation.

```sql
CREATE OR REPLACE FUNCTION update_investor_balances_bulk(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE investors i
  SET ledger_balance = (u->>'ledger_balance')::numeric
  FROM jsonb_array_elements(updates) AS u
  WHERE i.investor_code = u->>'investor_code';
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
```

### Step 2: Update ImportAdminBalanceDialog.tsx
Modify the import logic to use bulk operations:

**Current approach (slow):**
```typescript
// Lines 452-468: Individual updates per investor
for (const item of chunk) {
  await supabase
    .from("investors")
    .update({ ledger_balance: item.ledger_balance })
    .eq("investor_code", item.investor_code);
}
```

**New approach (fast):**
```typescript
// Batch updates using RPC - 1000 records per call
const BULK_BATCH_SIZE = 1000;
for (let i = 0; i < investorsToUpdate.length; i += BULK_BATCH_SIZE) {
  const batch = investorsToUpdate.slice(i, i + BULK_BATCH_SIZE);
  const updates = batch.map(item => ({
    investor_code: item.investor_code,
    ledger_balance: item.ledger_balance
  }));
  
  await supabase.rpc('update_investor_balances_bulk', { updates });
}
```

### Step 3: Optimize Commission Rate Updates
Similarly, create and use a bulk function for commission rate updates instead of individual PATCH requests.

## Files to Modify

| File | Changes |
|------|---------|
| Database Migration | Create `update_investor_balances_bulk` RPC function |
| `src/components/admin/ImportAdminBalanceDialog.tsx` | Replace individual updates with bulk RPC calls |

## Expected Performance Improvement

| Metric | Before | After |
|--------|--------|-------|
| Ledger balance updates | 23,961 requests | 24 requests (1000/batch) |
| Commission updates | ~24,000 requests | 24 requests (batched) |
| Holdings inserts | 150 batches (500/batch) | No change |
| Total time | 15-30 minutes | 2-3 minutes |

## Testing Checklist
After implementation:
1. Upload the Admin Balance file (Admin_Balance_31.01.2026.xlsx)
2. Verify progress bar moves smoothly through all stages
3. Confirm all 23,961 investors have updated ledger_balance values
4. Confirm 75,342 holdings are imported correctly
5. Verify import completes in under 5 minutes
