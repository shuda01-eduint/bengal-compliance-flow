

## Fix Investor Ledger Opening Balance Mismatch

### Problem Summary

The Investor Ledger for **KL167** shows **Opening Balance: 311,294.12** but the external system shows **559,562.86**. This is a difference of **248,268.74**.

### Root Cause Analysis

Two issues were identified:

1. **EOD Chain Break (Database Level)**
   - Jan 25 snapshot has `opening_balance = 4,423.32` instead of using Jan 24's `closing_balance = 252,692.06`
   - This is a -248,268.74 error that propagates forward
   - Jan 25 closing became 311,294.12 (wrong) instead of 559,562.86 (correct)

2. **Wrong Field in InvestorLedgerTab (Code Level)**
   - Line 93 fetches `ledger_balance` for opening balance lookup
   - Should fetch `closing_balance` to correctly follow the EOD chain

### Solution

#### Part 1: Database Fix (Manual Action Required)
Re-run Batch EOD for **Jan 25, 2026** with "Skip existing" turned **OFF** to rebuild the chain correctly

#### Part 2: Code Fix
Update `InvestorLedgerTab.tsx` to use `closing_balance` instead of `ledger_balance` for opening balance calculation:

**File: `src/components/investors/InvestorLedgerTab.tsx`**

```typescript
// Line 91-93: Change from ledger_balance to closing_balance
const { data: eodData, error: eodError } = await supabase
  .from('eod_ledger_snapshots')
  .select('closing_balance, eod_date')  // Changed from ledger_balance
  .eq('investor_code', searchedCode)
  .lte('eod_date', dateStr)
  .order('eod_date', { ascending: false })
  .limit(1);
```

```typescript
// Line 102-103: Use closing_balance
if (eodData && eodData.length > 0) {
  const snapshotDate = eodData[0].eod_date;
  const snapshotBalance = eodData[0].closing_balance || 0;  // Changed
```

### Expected Outcome

After both fixes:

| Metric | Current (Wrong) | Expected (Correct) |
|--------|-----------------|-------------------|
| Opening Balance (Jan 26) | 311,294.12 | 559,562.86 |
| Closing Balance (Jan 27) | -581,906.38 | -336,459.79 |
| Difference | 245,446.59 | Matches external ✅ |

### Technical Details

The `ledger_balance` and `closing_balance` fields in `eod_ledger_snapshots` should be identical in a healthy state, but the chain calculation uses `closing_balance` as the authoritative field for the running balance. When an EOD re-run occurs, `closing_balance` is recalculated but `ledger_balance` may retain stale data.

