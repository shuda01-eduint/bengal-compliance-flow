

# Fix Deposits/Withdrawals Import for Excel File

## Problem Summary
The import is failing because footer rows in the Excel file are not being properly filtered out. The file has summary rows like "Total of 2026-02-02 :", "Grand Total :", and "Print Date & Time :" that are passing through the current filter and causing validation errors.

## Root Cause Analysis
The file contains 401 valid data rows followed by 3 footer rows:
- Row 409: `|Total of 2026-02-02 :|34,013,947.52|113,326,241.83|...`
- Row 410: `|Grand Total :|34,013,947.52|113,326,241.83|...`
- Row 411: `|Print Date & Time : 2/2/2026 3:57:06PM|Powered By Cygnus Innovation Ltd.|...`

The current filter in `DepositsImportDialog.tsx` (lines 181-186) only checks:
- If the first column contains "date" (but "Total" does not contain "date")
- If the first column is empty
- If the SL column is not a number (but footer rows don't have the "SL" key)

These footer rows pass the filter and get mapped to records with:
- `investor_code`: "Total of 2026-02-02 :" (invalid)
- `amount`: some number value (from Debit/Credit columns)

This causes validation to fail or produces invalid records.

## Solution

### Enhance Footer Row Detection
Update the filter logic in `DepositsImportDialog.tsx` to exclude common footer patterns:

```text
Current filter:
- Contains "date" -> exclude
- Empty first column -> exclude  
- SL column exists but is not a number -> exclude

Enhanced filter (add these checks):
- Contains "total" -> exclude
- Contains "grand" -> exclude
- Contains "print" -> exclude
- Contains "page" -> exclude
- Contains "powered" -> exclude
```

### Implementation Changes

**File: `src/components/eod/DepositsImportDialog.tsx`**

Modify lines 181-186 to add additional footer row exclusion patterns:

```typescript
// Filter out rows that are date headers, footer rows, or empty
const filteredData = jsonData.filter((row: any) => {
  const firstCol = String(row["SL"] || row["Sl"] || row["sl"] || row["S.L"] || row["S.L."] || Object.values(row)[0] || '').trim().toLowerCase();
  
  // Exclude date header rows
  if (firstCol.includes('date')) return false;
  
  // Exclude empty rows
  if (!firstCol) return false;
  
  // Exclude footer/summary rows
  if (firstCol.includes('total')) return false;
  if (firstCol.includes('grand')) return false;
  if (firstCol.includes('print')) return false;
  if (firstCol.includes('page')) return false;
  if (firstCol.includes('powered')) return false;
  
  // If SL column exists, it must be a valid number
  if (row["SL"] !== undefined && isNaN(Number(firstCol))) return false;
  
  return true;
});
```

### Additional Safety Check
Also add validation to skip records where the investor_code looks like a footer:

```typescript
// In mappedRecords mapping, skip invalid investor codes
if (!investorCode || 
    investorCode.toLowerCase().includes('total') ||
    investorCode.toLowerCase().includes('grand') ||
    investorCode.toLowerCase().includes('print')) {
  return null;
}
```

Then filter out the null values after mapping.

## Expected Outcome
After this fix:
- The 401 valid data rows will be imported correctly
- Footer rows (Total, Grand Total, Print Date) will be excluded
- Deposits: ~113.3M (from Credit column for "Receipt" rows)
- Withdrawals: ~34M (from Debit column for "Paid" rows)

## Files to Modify

| File | Change |
|------|--------|
| `src/components/eod/DepositsImportDialog.tsx` | Add footer row exclusion patterns to the filter logic |

