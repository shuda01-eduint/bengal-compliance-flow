

## Plan: Fix EOD Summary Display and Missing Investor Auto-Creation

### Problem Summary
After running staged processing for Feb 02, 2026, the EOD Summary cards display all zeros and show "1 error" despite valid historical data existing in the EOD Run History table. This is caused by two issues:

1. **Summary display logic bug**: When batch processing fails, the UI shows the failed result (all zeros) instead of falling back to historical data
2. **Missing investors**: 175 investor codes in staging data are not in the `investors` master table, which may cause EOD processing to timeout

---

### Technical Analysis

**Root Cause 1: Display Priority Bug**
The current code in `EodPage.tsx` (lines 506-561) prioritizes data sources as:
```
1. Successful staged result (stagedResult?.success === true)
2. Batch results (dayResults.length > 0)  ← BUG: This includes failed results
3. Historical data (historicalData)
```

When a batch run fails, `dayResults.length > 0` is true, so it shows the failed result's zeros instead of the valid historical data.

**Root Cause 2: Missing Investors**
- 117 unique investor codes in `trade_file` for Feb 02 not found in `investors`
- 78 unique investor codes in `cash_ledger_txn` for Feb 02 not found in `investors`  
- Total: 175 unique missing codes
- Sample codes: 11144, 11283, 11469, 13264, 13557, etc.

**Root Cause 3: Statement Timeout**
Database logs show "canceling statement due to statement timeout" errors, likely because the EOD processing is too slow when handling unmatched data.

---

### Solution Steps

#### Step 1: Fix Summary Display Priority Logic
Modify `EodPage.tsx` to only use batch results when they are **successful**:

```typescript
// Current (buggy):
const useBatch = dayResults.length > 0;

// Fixed:
const useBatch = dayResults.length > 0 && dayResults.some(r => r.success);
```

This ensures that failed batch runs don't hide valid historical data.

#### Step 2: Add "Auto-Create Missing Investors" Button to EOD Page
Add a UI action to invoke the `auto_create_missing_investors` function for the selected date:
- Add an "Auto-Create Missing" button in `EodActionButtons.tsx`
- Show unmatched data count/warning on the EOD page when there's significant unmatched data
- Wire up the RPC call to `auto_create_missing_investors`

#### Step 3: Add Unmatched Data Warning to EOD Page
Display a prominent alert when the `useUnmatchedStagingData` hook detects missing investor codes:
- Show count of unmatched trades and deposits/withdrawals
- Display sample codes so admin knows which investors are missing
- Prompt to run auto-creation before processing

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/EodPage.tsx` | Fix `useBatch` logic; add auto-create handler; display unmatched warning |
| `src/components/eod/EodActionButtons.tsx` | Add "Auto-Create Missing" button |

---

### Implementation Details

**EodPage.tsx Changes:**

1. Import the `useUnmatchedStagingData` hook
2. Add state for auto-create processing
3. Add handler for auto-create RPC call
4. Fix the `useBatch` priority calculation
5. Add Alert component for unmatched data warning

**EodActionButtons.tsx Changes:**

1. Add new prop `onAutoCreateMissing`
2. Add new prop `isAutoCreating`
3. Add new button for auto-creation

---

### Expected Outcome

After implementation:
1. Failed EOD runs will show the last successful historical data instead of zeros
2. Admins will see a warning when there are unmatched investor codes
3. Admins can click "Auto-Create Missing" to generate placeholder records
4. Re-running EOD will include all investors in snapshots

