

# EOD (End-of-Day) Page Implementation Plan

## Overview

Create a dedicated EOD processing page at `/eod` that consolidates all end-of-day operations into a single, streamlined interface. This is a critical feature for the brokerage back-office system.

## Current State Analysis

The existing EOD functionality is scattered across different components:
- **BatchEodRunner** (`src/components/trade-history/BatchEodRunner.tsx`) - 1073 lines with full EOD processing logic
- **StockExchangeUpload** - Trade XML file import functionality
- **UploadHistoryTable** - Shows EOD run history, trade files, and deposit import stats
- **DepositsWithdrawalsTable** - For deposit/withdrawal data import

Existing database functions:
- `run_batch_eod` - Main EOD calculation function (already exists and is comprehensive)
- `clear_eod_by_date_range` - Clear EOD data for date range
- `clear_all_eod_data` - Clear all EOD data

**Note:** The functions `process_staged_trades()`, `process_settlements()`, and `calculate_settlement_date()` do not currently exist in the database. We will need to either:
1. Create these new functions, OR
2. Adapt the UI to work with the existing `run_batch_eod` function which already handles the full EOD process

## Implementation Approach

We will create the EOD page using existing functionality while adding new database functions for staged trades and settlements processing.

---

## Part 1: Create EOD Page

### File: `src/pages/EodPage.tsx`

Create a new page with the following sections:

**Header Section:**
- Date selector (calendar picker) for EOD date
- Mode toggle: Single Day / Date Range
- Quick date buttons: "Today", "Yesterday", "Last Business Day"

**EOD Status Dashboard (4 summary cards):**
- Pending Tasks count
- Completed Tasks count
- Failed Tasks count
- Last EOD Run status with timestamp

**Action Buttons Section:**
```
| Import Trade Data | Process Staged Trades | Calculate Settlements | Run Full EOD | Generate Report |
```
Each button will show loading state and success/error feedback.

**Progress Section:**
- Progress bar for multi-step operations
- Current step indicator
- Time elapsed

**Summary Cards (after EOD completes):**
- Total Trades Processed
- Total Clients Captured
- Settlement Amount
- Commission Generated
- Errors/Warnings count

**EOD Log Section:**
- Table showing EOD run history
- Columns: EOD Date, Run At, Run By, Clients, Ledger Balance, Trade Files, Status
- Filter by date range and status

---

## Part 2: Add Navigation

### File: `src/components/layout/Sidebar.tsx`

Add EOD to the navigation array:
```typescript
{ name: "EOD Processing", href: "/eod", icon: CalendarClock, adminOnly: true }
```

Position: After "Trade History" in the navigation order for logical workflow (Import data -> Process EOD).

---

## Part 3: Create Route

### File: `src/App.tsx`

Add the EOD route:
```typescript
import EodPage from "./pages/EodPage";
// ...
<Route path="/eod" element={<ProtectedRoute requireAdmin><EodPage /></ProtectedRoute>} />
```

---

## Part 4: Create EOD Components

### File: `src/components/eod/EodActionButtons.tsx`
Action buttons component with loading states and callbacks.

### File: `src/components/eod/EodStatusDashboard.tsx`
Dashboard cards showing pending/completed/failed task counts.

### File: `src/components/eod/EodSummaryCards.tsx`
Summary cards for trades processed, settlement amount, commission, etc.

### File: `src/components/eod/EodLogTable.tsx`
Table component displaying EOD run history with filtering.

### File: `src/components/eod/EodDateSelector.tsx`
Date picker component with single/range mode toggle.

---

## Part 5: Database Functions

### New Function: `process_staged_trades()`

This function will process trades that have been imported but not yet finalized:
- Validate staged trades
- Link to investor/client master data
- Calculate commissions
- Return processing summary

### New Function: `process_settlements()`

Handle T+2/T+3 settlement calculations:
- Identify trades due for settlement based on trade date and category
- Z Category: T+0 settlement (same day)
- Other Categories: T+2 settlement
- Update matured quantities and balances

### New Function: `calculate_settlement_date(trade_date, category)`

Utility function to calculate settlement date:
- Input: trade_date (date), category (text)
- Output: settlement_date (date)
- Logic: T+0 for Z category, T+2 for others (skip weekends/holidays)

---

## Part 6: Settlement Logic Implementation

Based on the memory context about DSE settlement rules:
- **Z Category**: T+3 (trades settle 3 days later)
- **Other Categories**: T+2 (trades settle 2 days later)

Create a helper function in the frontend:
```typescript
// src/lib/settlement-utils.ts
export function calculateSettlementDate(tradeDate: Date, category: string): Date
export function isTradeSettled(tradeDate: Date, category: string, asOfDate: Date): boolean
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/EodPage.tsx` | Create | Main EOD page |
| `src/components/eod/EodActionButtons.tsx` | Create | Action buttons component |
| `src/components/eod/EodStatusDashboard.tsx` | Create | Status dashboard cards |
| `src/components/eod/EodSummaryCards.tsx` | Create | Summary cards after EOD |
| `src/components/eod/EodLogTable.tsx` | Create | EOD history table |
| `src/components/eod/EodDateSelector.tsx` | Create | Date picker with modes |
| `src/lib/settlement-utils.ts` | Create | Settlement date calculations |
| `src/components/layout/Sidebar.tsx` | Modify | Add EOD nav item |
| `src/App.tsx` | Modify | Add /eod route |
| Database migration | Create | Add new RPC functions |

---

## Technical Details

### Component Reuse

We will extract and reuse logic from existing components:
- Date selection logic from `BatchEodRunner.tsx`
- EOD history table from `UploadHistoryTable.tsx`
- File upload from `StockExchangeUpload.tsx`

### State Management

The EOD page will use:
- React Query for data fetching and caching
- Local state for UI interactions
- Toast notifications for success/error feedback

### Error Handling

Following the existing pattern in `BatchEodRunner.tsx`:
- Detailed error messages from RPC responses
- Retry logic with exponential backoff using `rpcWithRetry`
- User-friendly error formatting using `formatRpcError`

---

## UI/UX Design

### Layout Structure

```text
+------------------------------------------------------------------+
|  EOD Processing                                                   |
|  Process end-of-day calculations and settlements                  |
+------------------------------------------------------------------+
|                                                                    |
|  [Date Selector]  [Single Day] [Date Range]  [Quick: Today|Yesterday]
|                                                                    |
+------------------------------------------------------------------+
|  Status Dashboard                                                  |
|  +----------+  +----------+  +----------+  +----------+           |
|  | Pending  |  | Running  |  | Complete |  | Failed   |           |
|  |    0     |  |    0     |  |    12    |  |    0     |           |
|  +----------+  +----------+  +----------+  +----------+           |
+------------------------------------------------------------------+
|  Actions                                                          |
|  [Import Trade Data] [Process Staged] [Settlements] [Run Full EOD]|
|  [Generate Report]                                                 |
+------------------------------------------------------------------+
|  [Progress Bar - visible when running]                            |
|  Processing 2025-01-30... (3/5 days)                              |
+------------------------------------------------------------------+
|  Summary (after completion)                                        |
|  +----------+  +----------+  +----------+  +----------+           |
|  | Trades   |  | Clients  |  | Settlement| | Commission|          |
|  | 45,231   |  | 32,847   |  | 2.3B BDT  | | 12.5M BDT |          |
|  +----------+  +----------+  +----------+  +----------+           |
+------------------------------------------------------------------+
|  EOD Run History                                                   |
|  +---------------------------------------------------------------+|
|  | Date     | Run At        | By       | Clients | Status        ||
|  | 30 Jan   | 30 Jan 18:30  | admin@.. | 32,847  | completed     ||
|  | 29 Jan   | 29 Jan 18:45  | admin@.. | 32,845  | completed     ||
|  +---------------------------------------------------------------+|
+------------------------------------------------------------------+
```

### Color Scheme

Following existing patterns:
- Primary gold accent for main actions
- Green for success states
- Amber for warnings
- Red for errors
- Muted foreground for secondary text

---

## Testing Checklist

1. Navigate to /eod route
2. Verify date selector works (single and range modes)
3. Test "Import Trade Data" button opens file dialog
4. Test "Run Full EOD" button triggers the `run_batch_eod` function
5. Verify progress bar shows during EOD processing
6. Check summary cards display correct data after EOD
7. Verify EOD history table shows past runs
8. Test error handling when EOD fails
9. Verify admin-only access (non-admins should be redirected)
10. Test mobile responsiveness

