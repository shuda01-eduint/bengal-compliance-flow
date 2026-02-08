
# Fix: Import Deposits/Withdrawals "OK" Button Not Visible

## Problem Identified
The Import Preview Dialog for deposits/withdrawals is showing all content (file date, row counts, replace option, totals), but the **footer with the "Cancel" and "Import Records" buttons is being cut off** below the visible viewport. This happens because:

1. **No max-height constraint**: The `AlertDialogContent` can grow indefinitely based on content
2. **No scrolling**: The dialog content area has no overflow handling
3. **Tall content**: When the "Replace existing data" option is visible and checked, it adds extra UI elements that push the footer out of view, especially on mobile screens

## Root Cause Analysis
Looking at the code:
- `ImportPreviewDialog.tsx` uses `AlertDialogContent` with `className="max-w-md"`
- The dialog has 4-5 Cards stacking vertically inside `<div className="space-y-4 py-4">`
- There is no `max-h-[...] overflow-y-auto` on the scrollable area
- `AlertDialogContent` uses `fixed top-[50%] translate-y-[-50%]` which centers vertically but doesn't prevent overflow

## Solution
Add proper viewport constraints and scrolling behavior to the ImportPreviewDialog:

### Changes to `src/components/trade-history/ImportPreviewDialog.tsx`

1. **Add max-height to AlertDialogContent**: Constrain the dialog to 90vh maximum
2. **Add overflow-y-auto to the content area**: Make the middle section scrollable while keeping header and footer fixed
3. **Ensure footer is always visible**: Keep buttons outside the scrollable area

```text
+-------------------------------------+
|  Import Preview (Header)           |  <- Fixed header
|-------------------------------------|
|  [Scrollable Content Area]         |  <- max-h with overflow-y-auto
|  - Detected Date card              |
|  - Row Counts card                 |
|  - Replace Option card             |
|  - Totals card                     |
|-------------------------------------|
|  [Cancel]        [Import Records]  |  <- Fixed footer (always visible)
+-------------------------------------+
```

### Technical Implementation

| Line Range | Change Description |
|------------|-------------------|
| Line 86 | Add `max-h-[90vh] flex flex-col` to `AlertDialogContent` |
| Line 97 | Add `flex-1 overflow-y-auto max-h-[60vh]` to the content wrapper div |

### Code Changes

**AlertDialogContent (line 86):**
```typescript
// Before:
<AlertDialogContent className="max-w-md">

// After:
<AlertDialogContent className="max-w-md max-h-[90vh] flex flex-col">
```

**Content wrapper (line 97):**
```typescript
// Before:
<div className="space-y-4 py-4">

// After:
<div className="space-y-4 py-4 flex-1 overflow-y-auto max-h-[60vh]">
```

**Footer (line 222):**
```typescript
// Before:
<AlertDialogFooter>

// After:
<AlertDialogFooter className="flex-shrink-0 pt-4">
```

## Benefits
- The "Cancel" and "Import Records" buttons will always be visible
- Long content scrolls within the dialog
- Works on all screen sizes including mobile
- Maintains the existing UI appearance and functionality
