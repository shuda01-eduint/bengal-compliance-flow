
# Fix Date Parsing Error in Admin Balance Import

## Problem Summary
When importing admin balances, a date parsing error occurs with the value `"01132620"` (expected format: `YYYY-MM-DD` like `2026-01-12`). This corrupted date format appears to be caused by timezone issues when formatting dates from the Calendar component.

## Root Cause Analysis
The issue stems from how JavaScript's Date object handles timezones:
1. The Calendar component (react-day-picker) returns a Date object
2. When using `format(date, "yyyy-MM-dd")` from date-fns, it may interpret the date differently based on timezone
3. In UTC+6 timezone (Bangladesh), dates selected near midnight can shift by a day when converted to/from UTC

The malformed date `01132620` suggests:
- Month: 01 (January)
- Day: 13
- Year: 2620 (corrupted - should be 2026)

This indicates the date components are being concatenated incorrectly, possibly due to a bug in how the Date object's components are being extracted.

## Technical Solution

### 1. Create Date Normalization Utility
Add a utility function in `src/lib/utils.ts` to safely format dates for database operations:

```typescript
/**
 * Safely format a Date to YYYY-MM-DD string using local date components.
 * This avoids timezone issues that occur with toISOString() or date-fns format().
 */
export function formatDateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Normalize a date to local midnight to avoid timezone issues.
 * Use this when receiving dates from Calendar/DatePicker components.
 */
export function normalizeToLocalDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
```

### 2. Update ImportAdminBalanceDialog.tsx
Replace all usages of `format(balanceDate, "yyyy-MM-dd")` with the new `formatDateToISO()` function.

**Files to modify:**
- Line 126: `const dateStr = format(balanceDate, "yyyy-MM-dd");`
- Line 346: `const dateStr = format(balanceDate, "yyyy-MM-dd");`
- Line 483: `const effectiveDateStr = balanceDate ? format(balanceDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');`

### 3. Update Calendar Selection Handler
Normalize the date when it's selected from the Calendar to prevent timezone drift:

```typescript
onSelect={(date) => date && setBalanceDate(normalizeToLocalDate(date))}
```

### 4. Apply Same Fix to Other Import Dialogs
Apply the same pattern to:
- `ImportBalancesRawDialog.tsx` (line 152)
- `CopyBalancesDialog.tsx` (lines 67-68, 73-74, 139-140, 249, 273, 320)
- `ImportCommissionsDialog.tsx` (line 120)

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/utils.ts` | Add `formatDateToISO()` and `normalizeToLocalDate()` functions |
| `src/components/admin/ImportAdminBalanceDialog.tsx` | Replace `format()` calls with `formatDateToISO()`, normalize calendar dates |
| `src/components/admin/ImportBalancesRawDialog.tsx` | Replace `format()` calls with `formatDateToISO()`, normalize calendar dates |
| `src/components/admin/CopyBalancesDialog.tsx` | Replace `format()` calls with `formatDateToISO()`, normalize calendar dates |
| `src/components/admin/ImportCommissionsDialog.tsx` | Replace `format()` calls with `formatDateToISO()` |

## Implementation Order
1. Add utility functions to `src/lib/utils.ts`
2. Update `ImportAdminBalanceDialog.tsx` (primary fix)
3. Update other import dialogs for consistency
4. Test with the Admin Balance import flow

## Testing Steps
After implementation:
1. Go to `/admin/balances` page
2. Click "Import Admin Balance Baseline"
3. Select a date (e.g., January 12, 2026) from the calendar
4. Upload an Excel file with balance data
5. Verify the import succeeds without date parsing errors
6. Check the database to confirm the `trade_date` is stored as `2026-01-12`
