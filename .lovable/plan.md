
# Fix EOD Opening Balance Priority to Use Official Baseline

## Problem Analysis
The Feb 1st closing balances are incorrect because `process_staged_trades` uses the **snapshot chain** (`eod_ledger_snapshots`) instead of the **official baseline** (`eod_investor_balance`) for opening balances.

### Evidence
| Investor | Excel (Expected) | DB Actual | Difference |
|----------|-----------------|-----------|------------|
| 13839 | -201,784 | -719,678 | 517,894 (wrong) |
| 20337 | -158,519 | +3,439,298 | 3.6M (wrong) |
| 21878 | -73,474 | -681,679 | 608,205 (wrong) |
| OBO4135 | -458,336 | -565,362 | 107,026 (wrong) |

### Root Cause
The `process_staged_trades` function (lines 84-102) gets opening balances from:
```sql
SELECT closing_balance AS opening_balance
FROM eod_ledger_snapshots
WHERE eod_date = v_prev_date;
```

It does NOT check `eod_investor_balance.closing_ledger_balance` first, which contains the official imported baseline.

---

## Solution

### Database Migration: Update process_staged_trades function

Modify STEP 2 to implement the correct priority chain:

```text
Priority 1: eod_investor_balance.closing_ledger_balance (official baseline)
Priority 2: eod_ledger_snapshots.closing_balance (previous day snapshot)
Priority 3: investors.ledger_balance (master table)
Priority 4: 0 (new accounts)
```

### Implementation Changes

```sql
-- STEP 2: Get opening balances with correct priority
CREATE TEMP TABLE tmp_opening_balances ON COMMIT DROP AS
SELECT 
  COALESCE(ob.investor_code, ls.investor_code) AS investor_code,
  -- Priority 1: Official baseline, Priority 2: Snapshot chain
  COALESCE(ob.closing_ledger_balance, ls.closing_balance) AS opening_balance,
  COALESCE(ls.cumulative_interest, 0) AS cumulative_interest
FROM eod_investor_balance ob
FULL OUTER JOIN eod_ledger_snapshots ls 
  ON ob.investor_code = ls.investor_code
  AND ls.eod_date = v_prev_date
WHERE ob.trade_date = v_prev_date;
```

This ensures:
1. If an official baseline exists for the previous date, use it
2. Fall back to snapshot chain only if no baseline imported
3. New accounts without either get 0 from master table

---

## Verification After Fix

1. Clear Feb 1st EOD data
2. Re-run `process_staged_trades('2026-02-01')`
3. Verify closing balances match Excel reference:
   - 13839: -201,784
   - 20337: -158,519
   - 21878: -73,474
   - OBO4135: -458,336

---

## Files to Modify

| File | Action |
|------|--------|
| Database function `process_staged_trades` | Update STEP 2 to use priority chain |

---

## Technical Details

The fix changes the opening balance source from:

**Before (Current - Broken):**
```sql
SELECT closing_balance FROM eod_ledger_snapshots WHERE eod_date = v_prev_date
```

**After (Fixed):**
```sql
SELECT 
  COALESCE(
    eod_investor_balance.closing_ledger_balance,  -- Priority 1
    eod_ledger_snapshots.closing_balance,         -- Priority 2
    investors.ledger_balance,                      -- Priority 3
    0                                              -- Priority 4
  ) AS opening_balance
```

This aligns with the documented fallback chain in the system architecture and ensures that official baseline imports act as authoritative "resets" for corrupted snapshot chains.
