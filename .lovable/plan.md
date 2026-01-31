
# Add Duplicate Handling with "Replace Existing Data" Option

## Summary

Add a "Replace existing data for this date" option to both the Deposits/Withdrawals and Trades import dialogs. When duplicates are detected, users will be able to choose between:
1. **Skip duplicates (default)**: Current behavior - only import new records
2. **Replace duplicates**: Delete existing records for the date(s) and import all new records

---

## Scope of Changes

### 1. ImportPreviewDialog.tsx (Shared Component)

Extend the preview dialog to support the new replace option:

**New Props:**
- `existingRecordsCount`: Number of existing records that would be deleted if replacing
- `showReplaceOption`: Whether to show the replace checkbox (only when duplicates exist)
- `replaceExisting`: Current checkbox state
- `onReplaceChange`: Callback when checkbox is toggled

**UI Changes:**
- Add a checkbox with label "Replace existing data for this date"
- Show warning: "This will delete X existing records and import Y new records"
- Warning uses destructive colors (red/orange) to indicate destructive action
- Checkbox only appears when there are duplicates detected

---

### 2. DepositsImportDialog.tsx

**State Changes:**
- Add `replaceExisting` state (boolean, default false)
- Add `existingRecordsCount` state to track how many records exist for the date(s)

**Analysis Phase Changes:**
- Query total count of existing records for the import date(s) to show in warning
- Pass this count to the preview dialog

**Import Logic Changes:**
- If `replaceExisting` is true:
  1. Delete all existing `deposits_withdrawals` records for the detected date(s)
  2. Import all valid records (skip the duplicate filtering)
- If `replaceExisting` is false:
  - Keep current behavior (filter out duplicates before import)

**Flow:**
```text
File Upload -> Analyze -> Preview Dialog
                            |
            [checkbox off]  |  [checkbox on]
                 |          |         |
         Skip dupes    Replace all data
              |               |
        Import new only   Delete existing,
                          Import all new
```

---

### 3. TradeImportDialog.tsx

**State Changes:**
- Add `replaceExisting` state (boolean, default false)
- Add `existingTradeCount` state for existing records count
- Add logic to count existing trades for the parsed trade dates

**Preview Phase Changes:**
- After parsing, query `trade_history` table to count existing records for the trade date(s)
- Show the count in a new warning section if duplicates would occur

**Import Logic Changes:**
- If `replaceExisting` is true:
  1. Delete all existing `trade_history` records for the import date(s) and board(s)
  2. Insert all parsed trades (no upsert, fresh insert)
- If `replaceExisting` is false:
  - Keep current upsert behavior (update existing, insert new)

**UI Changes:**
- Add a warning card in the preview step showing:
  - "X existing trades found for this date"
  - Checkbox: "Replace existing data for this date"
  - Warning text when checked: "This will delete X existing records and import Y new records"

---

## Technical Details

### Database Operations

**For Deposits/Withdrawals:**
```sql
-- When replacing, delete by date(s)
DELETE FROM deposits_withdrawals 
WHERE transaction_date IN (date1, date2, ...)
```

**For Trades:**
```sql
-- When replacing, delete by date(s)
DELETE FROM trade_history 
WHERE trade_date IN ('YYYYMMDD', ...)
```

### Import Preview Data Interface Update

```typescript
// Extended ImportPreviewData
export interface ImportPreviewData {
  // ... existing fields ...
  
  // New fields for replace functionality
  existingRecordsCount?: number;  // Records that exist for this date
}

// New props for ImportPreviewDialog
interface ImportPreviewDialogProps {
  // ... existing props ...
  
  showReplaceOption?: boolean;
  replaceExisting?: boolean;
  onReplaceChange?: (replace: boolean) => void;
}
```

### Warning Messages

**Deposits Dialog:**
- When duplicates detected: "X duplicate records found"
- Checkbox label: "Replace existing data for this date"
- Warning when checked: "This will delete X existing records and import Y new records"

**Trades Dialog:**
- When existing trades found: "X existing trades found for these dates"
- Checkbox label: "Replace existing trade data"
- Warning when checked: "This will delete X existing trades and import Y new trades"

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/trade-history/ImportPreviewDialog.tsx` | Add checkbox, warning display, new props |
| `src/components/eod/DepositsImportDialog.tsx` | Add replace state, count existing, conditional delete logic |
| `src/components/eod/TradeImportDialog.tsx` | Add replace state, count existing, add warning UI, conditional delete logic |

---

## User Flow Example

**Deposits Import with Replace:**

1. User uploads Excel file with 100 transactions for Jan 15, 2026
2. System detects 30 duplicates, 70 new records
3. Preview shows:
   - "100 records in file"
   - "30 duplicates detected (will skip)"
   - "70 new records to import"
   - "42 existing records for this date"
   - [ ] Replace existing data for this date
4. User checks the box
5. Warning appears: "This will delete 42 existing records and import 100 new records"
6. User confirms
7. System deletes 42 existing records, imports all 100 records

**Trade Import with Replace:**

1. User uploads CSE file with 500 trades for Jan 15, 2026
2. System detects 200 existing trades for that date
3. Preview shows:
   - "500 trades parsed"
   - Warning: "200 existing trades found for this date"
   - [ ] Replace existing trade data
4. User checks the box
5. Warning: "This will delete 200 existing trades and import 500 new trades"
6. User confirms
7. System deletes 200 existing, inserts 500 new trades
