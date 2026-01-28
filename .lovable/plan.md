

## Fix: Type Mismatch in EOD Function

### Problem Summary

The database error `operator does not exist: text = date` occurs because:

- `trade_history.trade_date` is stored as **TEXT** in format `YYYYMMDD` (e.g., `'20260113'`)
- `p_eod_date` is passed as **DATE** type
- PostgreSQL cannot compare these types directly

### Current Database State

The function has **6 locations** where this comparison fails:

| Line | Code | Context |
|------|------|---------|
| 39 | `WHERE trade_date = p_eod_date` | Trade files count |
| 44-45 | `WHERE trade_date = p_eod_date` | Deposit records count |
| 55 | `WHERE trade_date = p_eod_date` | Universe CTE - trades |
| 87 | `WHERE trade_date = p_eod_date` | Daily deposits CTE |
| 99 | `WHERE trade_date = p_eod_date` | Daily trades CTE |

### Solution

Replace all direct date comparisons with text-formatted comparisons:

```sql
-- Before (BROKEN):
WHERE trade_date = p_eod_date

-- After (FIXED):
WHERE trade_date = TO_CHAR(p_eod_date, 'YYYYMMDD')
```

### Implementation

Create a migration that replaces the entire `run_batch_eod` function with the corrected version. The key changes:

1. Add a local variable to hold the formatted date:
   ```sql
   v_eod_date_text TEXT := TO_CHAR(p_eod_date, 'YYYYMMDD');
   ```

2. Replace all `trade_date = p_eod_date` with `trade_date = v_eod_date_text`

3. Keep the deposits_withdrawals comparison as DATE (since that column IS a date type)

### What Won't Change

- Function signature: `(p_eod_date date, p_skip_existing boolean)`
- Business logic (delta calculation, opening balance chain, etc.)
- 300-second timeout and SECURITY DEFINER settings
- All table relationships and output format

### After This Fix

Once deployed:
1. Re-run EOD for January 13 - should complete successfully
2. Continue with remaining dates through January 28
3. Verify investor 21519's closing balance matches expected **-710,722.99**

### Risk Assessment

- **Low Risk**: This is a type conversion fix only, no logic changes
- **Tested Pattern**: The same `TO_CHAR` approach was already in the delta-calculation version (line 32)
- **Immediate Effect**: Will work as soon as migration is deployed

