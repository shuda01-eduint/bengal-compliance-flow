
# Fix Trade Import Date Parsing and Settlement Calculation

## Problem Summary

The trade import is showing dates like "0113-26-20" instead of "2026-01-13" because the code incorrectly parses YYYYMMDD format as DDMMYYYY format. Additionally, the settlement date calculation needs to use Bangladesh weekends (Friday/Saturday) and skip bank holidays.

---

## Root Cause Analysis

### 1. Date Parsing Bug (Lines 410-416 in TradeImportDialog.tsx)

The current code assumes 8-digit dates are in DDMMYYYY format:

```typescript
// CURRENT (WRONG):
else if (dateRaw.length === 8 && !dateRaw.includes("-")) {
  const day = dateRaw.substring(0, 2);    // "20" from "20260113"
  const month = dateRaw.substring(2, 4);  // "26" from "20260113"
  const year = dateRaw.substring(4, 8);   // "0113" from "20260113"
  tradeDate = `${year}${month}${day}`;    // "0113-26-20" - INVALID!
}
```

But the DSE XML provides dates in YYYYMMDD format ("20260113"), so the parsing should be:

```typescript
// FIXED:
else if (dateRaw.length === 8 && !dateRaw.includes("-")) {
  // Check if it's YYYYMMDD (starts with 19 or 20)
  if (dateRaw.startsWith("19") || dateRaw.startsWith("20")) {
    // Already YYYYMMDD - use as-is
    tradeDate = dateRaw;
  } else {
    // Assume DDMMYYYY
    const day = dateRaw.substring(0, 2);
    const month = dateRaw.substring(2, 4);
    const year = dateRaw.substring(4, 8);
    tradeDate = `${year}${month}${day}`;
  }
}
```

### 2. Time Formatting

The time field "100519" needs a formatting function for display:

```typescript
// Convert HHMMSS to HH:MM:SS
function formatTimeForDisplay(hhmmss: string): string {
  if (hhmmss.length === 6 && /^\d{6}$/.test(hhmmss)) {
    return `${hhmmss.slice(0,2)}:${hhmmss.slice(2,4)}:${hhmmss.slice(4,6)}`;
  }
  return hhmmss;
}
```

### 3. Bangladesh Weekends

Current `settlement-utils.ts` skips Saturday/Sunday, but Bangladesh Stock Exchange uses Friday/Saturday as weekends:

```typescript
// CURRENT (WRONG for Bangladesh):
if (!isWeekend(settleDate)) {  // Skips Sat/Sun
  daysAdded++;
}

// FIXED:
function isBangladeshWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6;  // Friday=5, Saturday=6
}
```

### 4. Holiday Support

Need to integrate Bangladesh bank holidays into settlement calculation.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/eod/TradeImportDialog.tsx` | Fix YYYYMMDD date parsing logic in `parseXmlRowToTrade` function |
| `src/lib/settlement-utils.ts` | Update to use Bangladesh weekends (Fri/Sat) and add holiday support |

---

## Implementation Details

### Phase 1: Fix Date Parsing in TradeImportDialog.tsx

**Location:** `parseXmlRowToTrade` function (around line 398-420)

**Changes:**
1. Detect YYYYMMDD vs DDMMYYYY format by checking if date starts with "19" or "20"
2. Handle YYYYMMDD correctly (already in target format)
3. Add time formatting function

```typescript
// Smart date format detection
function parseTradeDate(dateRaw: string): string {
  // Handle DD/MM/YYYY format
  if (dateRaw.includes("/")) {
    const parts = dateRaw.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
    }
  }
  
  // Handle 8-digit formats
  if (dateRaw.length === 8 && !dateRaw.includes("-")) {
    // YYYYMMDD format (starts with 19xx or 20xx)
    if (dateRaw.startsWith("19") || dateRaw.startsWith("20")) {
      return dateRaw; // Already correct
    }
    // DDMMYYYY format
    const day = dateRaw.substring(0, 2);
    const month = dateRaw.substring(2, 4);
    const year = dateRaw.substring(4, 8);
    return `${year}${month}${day}`;
  }
  
  // Handle YYYY-MM-DD format
  if (dateRaw.includes("-")) {
    return dateRaw.replace(/-/g, "");
  }
  
  return dateRaw;
}
```

### Phase 2: Update Settlement Utils

**Location:** `src/lib/settlement-utils.ts`

**Changes:**
1. Create Bangladesh weekend check function (Friday=5, Saturday=6)
2. Add Bangladesh bank holidays array (from CopyBalancesDialog.tsx)
3. Update `calculateSettlementDate` to skip both weekends AND holidays

```typescript
// Bangladesh weekends are Friday and Saturday
function isBangladeshWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6; // Friday=5, Saturday=6
}

// Bank holidays list (shared with CopyBalancesDialog)
const BANGLADESH_HOLIDAYS: string[] = [
  "2025-02-21", "2025-03-17", "2025-03-26", // ... etc
  "2026-01-01", "2026-02-21", "2026-03-17", // 2026 holidays
];

function isBankHoliday(date: Date): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  return BANGLADESH_HOLIDAYS.includes(dateStr);
}

function isNonTradingDay(date: Date): boolean {
  return isBangladeshWeekend(date) || isBankHoliday(date);
}

export function calculateSettlementDate(
  tradeDate: Date, 
  category: string | null | undefined
): Date {
  const settlementDays = getSettlementDays(category);
  let settleDate = new Date(tradeDate);
  let daysAdded = 0;

  while (daysAdded < settlementDays) {
    settleDate = addDays(settleDate, 1);
    // Skip Bangladesh weekends (Fri/Sat) and holidays
    if (!isNonTradingDay(settleDate)) {
      daysAdded++;
    }
  }

  return settleDate;
}
```

---

## Expected Results

| Input | Current Output | Fixed Output |
|-------|---------------|--------------|
| Date: "20260113" | "0113-26-20" (Invalid) | "2026-01-13" |
| Time: "100519" | "100519" | "10:05:19" |
| T+2 for trade on Thu Jan 15, 2026 | Sun Jan 17 (wrong) | Mon Jan 19 (correct, skips Fri/Sat) |
| T+2 for trade before Eid | Sat/Sun skip | Fri/Sat + Eid holidays skip |

---

## Technical Notes

1. **Date Detection Heuristic:** Checking if date starts with "19" or "20" reliably distinguishes YYYYMMDD from DDMMYYYY, since:
   - YYYYMMDD: "20260113" starts with "20"
   - DDMMYYYY: "13012026" starts with "13"

2. **Holiday Data:** The bank holidays are already defined in `CopyBalancesDialog.tsx`. We'll centralize them in a shared location or duplicate in settlement-utils for now.

3. **Settlement Rules:**
   - Category A/B: T+2 business days
   - Category Z: T+3 business days
   - Business days exclude Friday, Saturday, and bank holidays

---

## Testing Checklist

After implementation:
- [ ] Import DSE XML file with date "20260113" - should show "2026-01-13"
- [ ] Import DSE XML file with time "100519" - should show "10:05:19"
- [ ] Verify settlement date skips Friday and Saturday
- [ ] Verify settlement date skips bank holidays
- [ ] Test T+2 calculation around Eid holidays
- [ ] Test T+3 calculation for Z-category securities
