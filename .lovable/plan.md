
## Fix: EOD Function Ambiguity Error

### Problem

PostgreSQL error: "Could not choose the best candidate function between:
- `public.run_batch_eod(p_eod_date => date, p_skip_existing => boolean)`
- `public.run_batch_eod(p_eod_date => date, p_user_id => uuid, p_skip_existing => boolean)`"

There are **two versions** of the `run_batch_eod` function in the database. When the frontend calls it with only 2 parameters, PostgreSQL cannot determine which function to use.

### Root Cause

During previous migrations, a new version of `run_batch_eod` was created but the old 3-argument version was not removed, causing function overload ambiguity.

### Solution

Drop the old 3-argument function signature that includes `p_user_id`, keeping only the 2-argument version that the frontend uses:

```sql
DROP FUNCTION IF EXISTS public.run_batch_eod(date, uuid, boolean);
```

### Implementation Steps

1. Create migration to drop the obsolete 3-argument function
2. Verify only the 2-argument version remains
3. Re-test EOD run for January 13

### Technical Details

**Migration SQL:**
```sql
-- Remove the obsolete 3-argument version of run_batch_eod
-- The current implementation uses only (p_eod_date, p_skip_existing)
DROP FUNCTION IF EXISTS public.run_batch_eod(date, uuid, boolean);
```

### Risk Assessment

- **Low Risk**: The 3-argument version is not being called by any frontend code
- **Immediate Fix**: Once deployed, EOD will work immediately without code changes
