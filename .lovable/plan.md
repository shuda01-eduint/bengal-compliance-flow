
# Fix: Display Deposits/Withdrawals in EOD Summary Cards

## Problem Summary
The EOD Summary cards show zeros for deposits/withdrawals on Feb 02, even though the data was successfully imported. This happens because:
- EOD processing was run **before** the deposits/withdrawals file was imported
- The `eod_run_history` table stored the totals at that time (zeros)
- After import, the `cash_ledger_txn` table now contains the data (251 deposits = BDT 113.3M, 150 withdrawals = BDT 34M)
- The UI displays the stale historical record, not the current staging data

## Solution Overview
Add a "stale data" detection system that compares what's in the staging tables (`cash_ledger_txn`) against what's recorded in `eod_run_history`. When there's a mismatch, show a warning prompting the user to re-run EOD.

---

## Implementation Plan

### Step 1: Create Staging Summary Hook
Create a new hook that fetches the current totals from `cash_ledger_txn` for a selected date.

**New file: `src/hooks/useEodStagingSummary.ts`**

This hook will:
- Query `cash_ledger_txn` for the selected date
- Aggregate deposits and withdrawals
- Return totals for comparison with historical data

### Step 2: Add Stale Data Detection to EOD Page
Update `src/pages/EodPage.tsx` to:
- Use the new staging summary hook
- Compare staging totals with historical totals
- Display a warning alert when data has changed since last EOD run
- Show the current staging data in the summary cards when no EOD has been run yet

### Step 3: Update Summary Card Data Source Priority
Change the data priority for deposits/withdrawals in summary cards to:
1. Current staged result (from active processing)
2. Batch run summary (from current session batch)
3. **NEW: Current staging data** (from `cash_ledger_txn`)
4. Historical data (from `eod_run_history`) - only if matches staging

### Step 4: Add Stale Data Warning Alert
Add a warning alert that appears when:
- Historical EOD data exists for the date
- Current staging totals differ from historical totals
- Prompt user to "Re-run EOD" to capture the new data

---

## Technical Details

### New Hook: `useEodStagingSummary.ts`
```typescript
export interface EodStagingSummary {
  totalDeposits: number;
  totalWithdrawals: number;
  depositCount: number;
  withdrawalCount: number;
}

export function useEodStagingSummary(selectedDate: Date | undefined) {
  // Query cash_ledger_txn for current staging data
  // Returns aggregated totals for the date
}
```

### EodPage.tsx Changes
```typescript
// Compare historical vs staging
const isStale = historicalData && stagingSummary && (
  Math.abs(historicalData.total_deposits - stagingSummary.totalDeposits) > 0.01 ||
  Math.abs(historicalData.total_withdrawals - stagingSummary.totalWithdrawals) > 0.01
);

// Show warning when stale
{isStale && (
  <Alert variant="warning">
    <AlertTriangle className="h-4 w-4" />
    <AlertTitle>Data Changed Since Last EOD</AlertTitle>
    <AlertDescription>
      Deposits/Withdrawals have been updated since the last EOD run. 
      Click "Process Staged" or "Run Full EOD" to recalculate.
    </AlertDescription>
  </Alert>
)}
```

### Summary Card Priority Update
For `totalDeposits` and `totalWithdrawals`:
```typescript
totalDeposits={
  stagedResult?.total_deposits ?? 
  (dayResults.length > 0 ? summary.totalDeposits : null) ?? 
  stagingSummary?.totalDeposits ??  // NEW: Show staging data
  historicalData?.total_deposits ?? 
  0
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useEodStagingSummary.ts` | **NEW** - Hook to fetch current staging totals |
| `src/pages/EodPage.tsx` | Add stale detection, warning alert, update card priorities |
| `src/components/ui/alert.tsx` | Add `warning` variant (amber styling) |

---

## Expected Outcome
After implementation:
1. When selecting Feb 02, the UI will show the **current staging data** (৳113.3M deposits, ৳34M withdrawals)
2. A warning will appear indicating EOD needs to be re-run
3. After re-running EOD, the historical data will match and the warning will disappear
4. Future imports will trigger the same warning until EOD is re-processed
