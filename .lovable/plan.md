

# Fix: Portfolio Value Shows 0 Due to Date Mismatch

## Problem
Investor **3008** and others show **portfolio value = 0** in the Client Accounts tab, even though holdings data exists.

## Root Cause
The two snapshot tables have **different latest dates**:

| Table | Latest Date | Records |
|-------|-------------|---------|
| `eod_ledger_snapshots` | **Jan 29** | Has data |
| `eod_holding_snapshots` | **Jan 28** | Has data |

The current code queries both tables using the **same date** (from ledger snapshots = Jan 29). Since there are **0 holding records** for Jan 29, all portfolio values are 0.

## Solution
Modify the query logic to get portfolio values from the **latest available date** in `eod_holding_snapshots` that is **less than or equal to** the target date.

### Code Change in `ClientAccountsTab.tsx`

**Current (broken):**
```typescript
// Get portfolio values from eod_holding_snapshots for the same date
const { data: holdingData } = await supabase
  .from('eod_holding_snapshots')
  .select('investor_code, market_value')
  .eq('eod_date', targetDate);  // ← Jan 29 has 0 records!
```

**Fixed:**
```typescript
// Get the latest available holding date (may differ from ledger date)
const { data: latestHoldingDate } = await supabase
  .from('eod_holding_snapshots')
  .select('eod_date')
  .lte('eod_date', targetDate)  // ← Find latest available date up to targetDate
  .order('eod_date', { ascending: false })
  .limit(1)
  .maybeSingle();

const holdingDate = latestHoldingDate?.eod_date || targetDate;

// Get portfolio values from the available date
const { data: holdingData } = await supabase
  .from('eod_holding_snapshots')
  .select('investor_code, market_value')
  .eq('eod_date', holdingDate);  // ← Use Jan 28 if Jan 29 not available
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/margin-loan/ClientAccountsTab.tsx` | Query holdings from latest available date ≤ target date |

## Expected Outcome

After the fix:
- **3008** will show portfolio value of **৳2.37 Cr** (23.71M)
- All investors will correctly show their holdings-based portfolio values
- The system gracefully handles date gaps between ledger and holding snapshots

