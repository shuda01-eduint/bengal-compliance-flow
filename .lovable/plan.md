
# Fix: Trade Import Overwriting Issue (DSE/CSE)

## Problem Identified

When importing trades with "Replace existing" mode enabled, the system deletes **ALL trades for the selected date** instead of only deleting trades from the **same exchange source**. This means:
- Importing DSE trades deletes previously imported CSE trades
- Importing CSE trades deletes previously imported DSE trades

## Root Cause

In `src/components/eod/TradeImportDialog.tsx` (lines 632-640):

```javascript
if (replaceExisting) {
  for (const tradeDate of tradeDatesForDb) {
    const { error: deleteError } = await supabase
      .from("trade_file")
      .delete()
      .eq("trade_date", tradeDate);  // ← Deletes ALL exchanges!
```

The delete query only filters by `trade_date` but not by `exchange_code`.

## Solution

Modify the delete logic to filter by exchange source:
- **DSE files (.xml)**: Delete only records where `exchange_code = 'DSE'`
- **CSE files (.txt)**: Delete only records where `exchange_code LIKE 'DHK%'` (CSE terminals start with DHK)

---

## Technical Implementation

### 1. Update the Replace Logic in TradeImportDialog.tsx

**File:** `src/components/eod/TradeImportDialog.tsx`

Modify the delete logic inside `handleImport()` to:

```typescript
// If replacing, delete existing trades for the dates and same exchange only
if (replaceExisting) {
  const isXml = file?.name.toLowerCase().endsWith('.xml');
  
  for (const tradeDate of tradeDatesForDb) {
    if (isXml) {
      // DSE file: delete only DSE exchange trades
      const { error: deleteError } = await supabase
        .from("trade_file")
        .delete()
        .eq("trade_date", tradeDate)
        .eq("exchange_code", "DSE");
    } else {
      // CSE file: delete only CSE exchange trades (DHK terminals)
      const { error: deleteError } = await supabase
        .from("trade_file")
        .delete()
        .eq("trade_date", tradeDate)
        .like("exchange_code", "DHK%");
    }
    
    if (deleteError) throw deleteError;
  }
}
```

### 2. Update Existing Trade Count Display

The "existing trades" count in preview should also be exchange-specific. Update the count query (lines 578-588) to filter by exchange:

```typescript
// Count existing trades for the parsed dates (same exchange only)
const isXml = file.name.toLowerCase().endsWith('.xml');

for (const tradeDate of tradeDates) {
  let query = supabase
    .from("trade_file")
    .select("*", { count: "exact", head: true })
    .eq("trade_date", tradeDate);
  
  if (isXml) {
    query = query.eq("exchange_code", "DSE");
  } else {
    query = query.like("exchange_code", "DHK%");
  }
  
  const { count, error: countErr } = await query;
  // ...
}
```

### 3. Improve UI Messaging

Update the replace checkbox label to clarify the behavior:
- Current: "Replace existing data for this date"
- Updated: "Replace existing [DSE/CSE] data for this date"

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/eod/TradeImportDialog.tsx` | Filter delete by exchange_code (DSE vs DHK%) |
| `src/components/eod/TradeImportDialog.tsx` | Filter existing count by exchange |
| `src/components/eod/TradeImportDialog.tsx` | Update UI to show exchange-specific messaging |

## Expected Behavior After Fix

1. **Import DSE file with Replace**: Only deletes existing DSE trades, keeps CSE trades
2. **Import CSE file with Replace**: Only deletes existing CSE trades, keeps DSE trades
3. **Preview shows**: "X existing DSE trades" or "X existing CSE trades" based on file type
