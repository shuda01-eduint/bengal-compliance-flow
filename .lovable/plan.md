

# Fix Admin Balance Import & Add to EOD Page

## Problem Summary

The Admin Balance import is failing with:
```
date/time field value out of range: "01132620"
```

This is caused by **corrupted data in the database**, not frontend date formatting. The `trade_history` table contains 23,737 rows with `trade_date='01132620'` (invalid format: MMDDYYYY without separators) instead of the correct `'20260113'` (YYYYMMDD). These rows are duplicates of existing correct records (verified by matching `exec_id`).

When the SQL functions `get_admin_balances_enriched` and `get_admin_balances_summary` execute `trade_date::date`, PostgreSQL cannot parse the malformed string.

---

## Solution Overview

### Part 1: Delete Corrupted Data (Database Fix)

Execute a DELETE statement to remove the 23,737 bad rows:

```sql
DELETE FROM trade_history WHERE trade_date = '01132620';
```

This is safe because:
- All rows with `trade_date='01132620'` have matching `exec_id` values in rows with `trade_date='20260113'`
- They are duplicates created by a previous import with incorrect date formatting

### Part 2: Add Admin Balance Import to EOD Page

Add the `ImportAdminBalanceDialog`, `ImportBalancesRawDialog`, and `CopyBalancesDialog` components to the EOD page, creating a new "Baseline Balances" section.

---

## Implementation Details

### Step 1: Delete Corrupted Data
Run migration to delete the malformed trade_date records:
- Target: `trade_history` table
- Condition: `trade_date = '01132620'`
- Records affected: 23,737 duplicate rows

### Step 2: Update EOD Page
Add a new "Import Baseline Balances" section with:
- `ImportAdminBalanceDialog` - Full admin balance import with investor/holdings updates
- `ImportBalancesRawDialog` - Raw balance data import
- `CopyBalancesDialog` - Copy balances between dates
- `ImportOpeningBalancesDialog` - Simple opening balance import for EOD chain

### Step 3: Update Imports in EOD Page
File: `src/pages/EodPage.tsx`
- Add imports for the balance import dialogs
- Add state for the dialog open states
- Add a new Card/section with "Import Baseline Balances" header
- Place buttons to trigger each dialog

### Step 4: Keep Existing Admin Balances Page Unchanged
The `/admin/balances` page will retain its import buttons as-is, maintaining backward compatibility.

---

## Files to Modify

| File | Changes |
|------|---------|
| (Database) | DELETE statement to remove 23,737 rows where `trade_date='01132620'` |
| `src/pages/EodPage.tsx` | Add import dialogs for baseline balances, add UI section |

---

## Testing Checklist
After implementation:
1. Navigate to `/admin/balances` 
2. Select January 12, 2026
3. Verify the page loads without the date parsing error
4. Navigate to `/eod`
5. Verify the new "Import Baseline Balances" section appears
6. Test each import dialog opens and functions correctly

