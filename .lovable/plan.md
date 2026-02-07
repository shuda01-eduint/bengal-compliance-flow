
# Fix: EOD Date Display Shifted by 1 Day (Timezone Issue)

## Problem Identified
The EOD Run History table is displaying dates shifted by 1 day:
- Database has `2026-02-05` but UI shows `04 Feb 2026`
- Database has `2026-02-03` but UI shows `02 Feb 2026` (which looks like it's missing)

**Root Cause:** When JavaScript parses a date-only string like `"2026-02-05"` using `new Date()`, it interprets it as midnight UTC. For users in Bangladesh (UTC+6), this becomes `2026-02-04 18:00:00` local time, causing the date to shift back by one day when formatted.

## Solution
Use `parseISO` from `date-fns` which properly handles date-only strings, or manually parse the date to avoid timezone conversion.

### Fix in `EodLogTable.tsx` (Line 132)

**Current (broken):**
```typescript
{format(new Date(row.run_date), "dd MMM yyyy")}
```

**Fixed:**
```typescript
// Option 1: Use parseISO which handles date-only strings correctly
import { parseISO } from "date-fns";
{format(parseISO(row.run_date), "dd MMM yyyy")}

// Note: parseISO parses "2026-02-05" as local date at midnight,
// avoiding the UTC interpretation that causes the shift
```

### Files to Modify

| File | Change |
|------|--------|
| `src/components/eod/EodLogTable.tsx` | Import `parseISO` from date-fns and use it to parse `run_date` to avoid timezone shift |

### Technical Details
- `new Date("2026-02-05")` parses as UTC midnight, causing timezone offset issues
- `parseISO("2026-02-05")` from date-fns handles date-only strings correctly and returns a local date
- This ensures `05 Feb 2026` displays correctly regardless of user timezone
- The `run_at` timestamp can continue using `new Date()` since it includes timezone info (`2026-02-05T10:38:37.699698+00:00`)
