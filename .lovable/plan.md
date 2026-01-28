

# Fix: Accounting Page Date Selection Off-by-One Bug

## Problem Identified

When selecting **Jan 28** in the date picker, the Accounting page displays data for **Jan 27** instead. The console logs confirm:

```text
startDateStr: "2026-01-27"  (should be 2026-01-28)
endDateStr: "2026-01-27"    (should be 2026-01-28)
fromDate: "2026-01-26T18:00:00.000Z"  (Jan 27 midnight in UTC+6)
```

The dates are consistently **one day behind** what the user selected.

## Root Cause

The `react-day-picker` Calendar component returns a Date object at **midnight UTC** for the selected day. When the user is in a timezone like Bangladesh (UTC+6), this UTC midnight becomes the **previous day** at 6:00 PM local time. The `date-fns format()` function then formats this according to local time, resulting in the previous day's date string.

**Example flow:**
1. User clicks "Jan 28" in calendar
2. Calendar returns: `new Date('2026-01-28T00:00:00.000Z')` (midnight UTC)
3. In Bangladesh (UTC+6), this is: Jan 28, 6:00 AM local
4. But the Date object stores it as UTC, and when `format()` runs in local context, timezone handling causes the issue

## Solution

Normalize dates immediately when selected from the calendar by creating a new Date object using **local time components** rather than relying on the potentially timezone-shifted Date from the calendar.

### Changes Required

**File: `src/components/trade-history/AccountingTab.tsx`**

1. **Add a date normalization utility function:**
   ```typescript
   // Normalize a date to local midnight to avoid timezone issues
   const normalizeToLocalDate = (date: Date): Date => {
     return new Date(date.getFullYear(), date.getMonth(), date.getDate());
   };
   ```

2. **Update the `handleFromDateChange` function:**
   ```typescript
   const handleFromDateChange = (date: Date | undefined) => {
     if (date) {
       const normalizedDate = normalizeToLocalDate(date);
       setFromDate(normalizedDate);
       if (normalizedDate > toDate) {
         setToDate(normalizedDate);
       }
     }
   };
   ```

3. **Update the Calendar onSelect for toDate:**
   ```typescript
   onSelect={(d) => d && setToDate(normalizeToLocalDate(d))}
   ```

4. **Update the initial date fetch to also normalize:**
   ```typescript
   // In the fetchLatestTradeDate useEffect
   const latestDate = normalizeToLocalDate(new Date(year, month, day));
   ```

## Technical Details

- The `normalizeToLocalDate()` function extracts year, month, and day components and creates a new Date at local midnight
- This ensures the Date object represents the correct calendar date in the user's local timezone
- The `date-fns format()` will then produce the expected date string

## Expected Outcome

After this fix:
- Selecting "28 Jan" will correctly query data for `_tx_date: "2026-01-28"`
- The opening date will correctly be `"2026-01-27"` (one day before)
- The turnover, commission, and accounting data will display for the correct date range

