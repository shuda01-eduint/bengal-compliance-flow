

## EOD Run History Table Enhancements & Calculate Settlements Feature

### Overview
This plan covers two enhancements to the EOD Processing page:
1. **Extended EOD Run History Table** - Add columns for Deposits, Withdrawals, Net Cash Flow, Gross Buy, Gross Sell, and Total Trade Amount
2. **Calculate Settlements Feature** - Implement the settlement calculation functionality based on DSE T+2/T+3 rules

---

## Part 1: EOD Run History Table Enhancements

### Current State
The `EodLogTable` component currently displays 7 columns:
- EOD Date, Run At, Run By, Clients, Ledger Balance, Trade Files, Status

The database table `eod_run_history` already has the required columns:
- `total_deposits`, `total_withdrawals`, `gross_buy`, `gross_sell`, `total_commission`

### Changes Required

**File: `src/components/eod/EodLogTable.tsx`**

1. Update the interface to include missing fields that are already in the database
2. Add new columns to the table:
   - Deposits (formatted currency)
   - Withdrawals (formatted currency)  
   - Net Flow (calculated: deposits - withdrawals, with color coding)
   - Gross Buy (formatted currency)
   - Gross Sell (formatted currency)
   - Total Trades (calculated: gross_buy + gross_sell)
   - Commission (formatted currency)

3. Make the table horizontally scrollable for smaller screens

### New Table Layout
```text
+----------+----------+---------+--------+---------+------------+------------+----------+------------+------------+--------------+--------+
| EOD Date | Run At   | Run By  |Clients |Deposits |Withdrawals | Net Flow   | Gross Buy| Gross Sell |Total Trades|Commission    | Status |
+----------+----------+---------+--------+---------+------------+------------+----------+------------+------------+--------------+--------+
|01 Feb 26 |01 Feb 15:| user@.. | 32,846 | ৳338.24M| ৳168.80M   | +৳169.44M  | ৳865.59M | ৳823.33M   | ৳1.69B     |৳6,759        |complete|
+----------+----------+---------+--------+---------+------------+------------+----------+------------+------------+--------------+--------+
```

---

## Part 2: Calculate Settlements Feature

### Business Context
DSE (Dhaka Stock Exchange) uses T+2/T+3 settlement rules:
- **Z Category securities**: Settle in T+3 (3 trading days after trade)
- **All other categories**: Settle in T+2 (2 trading days after trade)
- Bangladesh weekends are Friday/Saturday (not Saturday/Sunday)
- Bank holidays must be skipped when calculating settlement dates

### Feature Requirements
When user clicks "Calculate Settlements" for a selected date:
1. Calculate which trades are settling ON that date (settlement_date = selected date)
2. Show breakdown by investor of:
   - Settlement obligations (buys that need payment)
   - Settlement receipts (sells that generate funds)
   - Net settlement amount per investor

### Implementation Approach

**Option A: Client-side calculation with dialog display (Recommended)**

Create a new component `SettlementCalculationDialog` that:
1. Queries `trade_file` for trades where `settlement_date = selected_date`
2. Aggregates by investor showing buy/sell/net values
3. Displays results in a modal with export capability

**Database Query Logic:**
```sql
SELECT 
  investor_code,
  SUM(CASE WHEN UPPER(side) IN ('B','BUY') THEN qty * price ELSE 0 END) as buy_settlement,
  SUM(CASE WHEN UPPER(side) IN ('S','SELL') THEN qty * price ELSE 0 END) as sell_settlement,
  -- Net = Sell - Buy (positive = receives money, negative = pays money)
  SUM(CASE WHEN UPPER(side) IN ('S','SELL') THEN qty * price 
           WHEN UPPER(side) IN ('B','BUY') THEN -qty * price 
           ELSE 0 END) as net_settlement
FROM trade_file
WHERE settlement_date = :selected_date
GROUP BY investor_code
ORDER BY ABS(net_settlement) DESC;
```

### New Components

**File: `src/components/eod/SettlementCalculationDialog.tsx`**

A dialog component that:
- Takes a settlement date as prop
- Fetches settlement data for that date
- Shows summary cards: Total Buy Obligations, Total Sell Receipts, Net Market Position
- Shows investor-level breakdown in a paginated table
- Supports export to Excel
- Shows "no settlements" state if the date has no settling trades

### UI Design

```text
+--------------------------------------------------+
| Settlement Calculations for 03 Feb 2026          |
+--------------------------------------------------+
| Summary:                                         |
| +-------------+ +-------------+ +-------------+  |
| |Buy Settl.   | |Sell Settl.  | |Net Position |  |
| |৳853.56M     | |৳811.47M     | |-৳42.09M    |  |
| +-------------+ +-------------+ +-------------+  |
+--------------------------------------------------+
| Investor Breakdown:                    [Export]  |
| +--------+------------+------------+------------+|
| |Code    |Buy Settl.  |Sell Settl. |Net         ||
| +--------+------------+------------+------------+|
| |ABC001  |৳5,234,500  |৳2,100,000  |-৳3,134,500 ||
| |XYZ002  |৳0          |৳8,500,000  |+৳8,500,000 ||
| +--------+------------+------------+------------+|
+--------------------------------------------------+
```

---

## Implementation Steps

### Step 1: Update EodLogTable (Part 1)
- Update `EodRunHistory` interface to include all available columns
- Add 6 new table columns with proper formatting
- Add horizontal scroll wrapper for mobile responsiveness
- Use color coding for Net Flow (green positive, red negative)

### Step 2: Create SettlementCalculationDialog (Part 2)
- Create new component with React Query for data fetching
- Implement summary cards at the top
- Add virtualized table for investor breakdown (can be thousands of rows)
- Add Excel export functionality using the existing xlsx library

### Step 3: Wire up EodPage
- Import and integrate the new dialog
- Connect the "Calculate Settlements" button to open the dialog
- Pass the selected date to the dialog

---

## Technical Notes

### Existing Assets Available
- `xlsx` library is already installed for Excel export
- `@tanstack/react-virtual` is available for virtualized lists if needed
- Settlement date calculation utilities exist in `src/lib/settlement-utils.ts`
- Currency formatting helpers already used in `EodLogTable` and `EodSummaryCards`

### Database Considerations
- No schema changes needed - all required data exists in `eod_run_history` and `trade_file`
- Settlement queries should be indexed (settlement_date column in trade_file)

### Performance
- Settlement calculation query may return many rows - use pagination or virtualization
- Consider caching results for frequently accessed dates

