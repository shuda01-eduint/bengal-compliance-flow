

# Fix Admin Balance Import - Data Not Visible After Import

## Problem Identified

Your import **WAS successful** - 23,961 records were imported for January 31, 2026. However, you cannot select January 31st in the date picker because:

**The Admin Balances page queries a different table than where the import saves data.**

| Component | Table Used | January 31st Data |
|-----------|-----------|-------------------|
| Import Admin Balance | `eod_investor_balance` | 23,961 records (imported) |
| Admin Balances Page | `balances_raw` | No data (empty for Jan 31) |

The date picker only shows dates that exist in `balances_raw`, which currently has data only up to January 12, 2026.

## Solution

Update the `ImportAdminBalanceDialog` to also populate the `balances_raw` table, which the Admin Balances page uses for display. This ensures imported data is immediately visible.

## Changes Required

### File: `src/components/admin/ImportAdminBalanceDialog.tsx`

Add a new step in the import process to insert holdings data into `balances_raw` table (in addition to `eod_investor_balance`):

**Current Flow:**
1. Clear existing `eod_investor_balance` for the date
2. Clear future EOD data if requested
3. Import to `eod_investor_balance`
4. Update investors table with ledger balances
5. Update commission rates
6. Import holdings to `holdings` table

**Updated Flow (add step 3b):**
1. Clear existing `eod_investor_balance` for the date
2. Clear future EOD data if requested
3. Import to `eod_investor_balance`
3b. **NEW: Import to `balances_raw` table** (for Admin Balances page visibility)
4. Update investors table with ledger balances
5. Update commission rates
6. Import holdings to `holdings` table

### New Step Implementation

After importing to `eod_investor_balance`, add import to `balances_raw`:

```typescript
// STEP 3b: Import to balances_raw for Admin Balances page visibility
setProgressStage("Syncing to balances view...");

// First clear existing balances_raw for this date
await supabase.from("balances_raw").delete().eq("as_of_date", dateStr);

// Group holdings by investor to create balance rows
const holdingsByInvestor = parsedData.reduce((acc, item) => {
  if (!acc[item.investor_code]) acc[item.investor_code] = [];
  if (item.instrument) acc[item.investor_code].push(item);
  return acc;
}, {});

// Insert balance rows with holdings
const balanceRows = [];
for (const [code, holdings] of Object.entries(holdingsByInvestor)) {
  const investorInfo = uniqueInvestors.get(code);
  for (const holding of holdings) {
    balanceRows.push({
      as_of_date: dateStr,
      investor_code: code,
      instrument: holding.instrument,
      total_stock: holding.total_stock,
      saleable: holding.saleable,
      avg_cost: holding.avg_cost,
      total_cost: holding.total_cost,
      total_mv: holding.market_value,
      ledger_balance: investorInfo?.ledger_balance || 0,
      rm_email: investorInfo?.rm_email || null,
      rm_name: investorInfo?.rm_name || null,
    });
  }
}

// Batch insert to balances_raw
for (let i = 0; i < balanceRows.length; i += batchSize) {
  const batch = balanceRows.slice(i, i + batchSize);
  await supabase.from("balances_raw").insert(batch);
}
```

### Additional: Query Cache Invalidation

After import completes successfully, invalidate React Query cache to trigger immediate UI refresh:

```typescript
// In onSuccess callback
queryClient.invalidateQueries({ queryKey: ['balances-raw-dates'] });
queryClient.invalidateQueries({ queryKey: ['balances-enriched'] });
queryClient.invalidateQueries({ queryKey: ['balances-summary'] });
```

## Expected Result After Fix

- Import will populate both `eod_investor_balance` (for EOD processing) AND `balances_raw` (for Admin Balances display)
- January 31st will appear in the date picker immediately after import
- All 23,677 investors with their holdings will be visible on the Admin Balances page

## Summary

| Action | Purpose |
|--------|---------|
| Add `balances_raw` insert | Make imported data visible on Admin Balances page |
| Clear existing date data | Prevent duplicates when re-importing |
| Invalidate query cache | Refresh UI immediately without page reload |

