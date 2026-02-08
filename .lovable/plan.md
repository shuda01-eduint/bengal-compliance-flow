
# Add Ledger Tab to Accounting Page

## Overview
Add a third "Ledger" tab to the Accounting page after the existing "Margin Loan" and "Commission" tabs. The Ledger tab will provide a daily overview of all investor ledger entries from EOD snapshots, with drill-down capability to view individual investor transaction history.

## Architecture

The implementation follows the existing tab pattern used in AccountingTab.tsx, which uses a custom button toggle system (not the Tabs component) to switch between views.

```text
+-------------------------------------------+
|  Tab Toggle: [Margin Loan] [Commission] [Ledger] |
+-------------------------------------------+
|  Ledger Tab Content:                      |
|  +---------------------------------------+|
|  |  Summary Cards (3):                   ||
|  |  [Total Debit] [Total Credit] [Net]   ||
|  +---------------------------------------+|
|  |  Searchable Investor Table            ||
|  |  (from eod_ledger_snapshots)          ||
|  +---------------------------------------+|
|  |  Click Row -> Drill-down Dialog       ||
|  |  - Date range filter                  ||
|  |  - Transaction table                  ||
|  |  - Daily balance chart                ||
|  +---------------------------------------+|
+-------------------------------------------+
```

## Database Changes

### 1. Create View: `v_ledger_dashboard`
Aggregates daily ledger totals from EOD snapshots.

```sql
CREATE VIEW v_ledger_dashboard AS
SELECT 
  eod_date,
  COALESCE(SUM(total_deposits), 0) + COALESCE(SUM(gross_sell), 0) as total_credit,
  COALESCE(SUM(total_withdrawals), 0) + COALESCE(SUM(gross_buy), 0) + COALESCE(SUM(total_commission), 0) as total_debit,
  (COALESCE(SUM(total_deposits), 0) + COALESCE(SUM(gross_sell), 0)) - 
  (COALESCE(SUM(total_withdrawals), 0) + COALESCE(SUM(gross_buy), 0) + COALESCE(SUM(total_commission), 0)) as net_balance,
  COUNT(DISTINCT investor_code) as client_count
FROM eod_ledger_snapshots
GROUP BY eod_date;
```

### 2. Create RPC Function: `get_ledger_by_date`
Returns investor ledger entries for a specific date, with role-based filtering.

```sql
CREATE FUNCTION get_ledger_by_date(
  _eod_date date,
  _search text DEFAULT NULL,
  _limit int DEFAULT 500
) RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  department text,
  total_deposits numeric,
  total_withdrawals numeric,
  gross_buy numeric,
  gross_sell numeric,
  total_commission numeric,
  opening_balance numeric,
  closing_balance numeric,
  total_debit numeric,
  total_credit numeric
) ...
```

### 3. Create RPC Function: `get_investor_ledger`
Returns detailed ledger transactions for a specific investor and date range.

```sql
CREATE FUNCTION get_investor_ledger(
  _investor_code text,
  _from_date date,
  _to_date date
) RETURNS TABLE (
  txn_date date,
  entry_type text,
  scrip_name text,
  qty integer,
  rate numeric,
  trade_value numeric,
  commission numeric,
  debit numeric,
  credit numeric,
  running_balance numeric
) ...
```

### 4. Create RPC Function: `get_investor_daily_balances`
Returns daily closing balances for the balance chart.

```sql
CREATE FUNCTION get_investor_daily_balances(
  _investor_code text,
  _from_date date,
  _to_date date
) RETURNS TABLE (
  balance_date date,
  closing_balance numeric
) ...
```

## Frontend Changes

### 1. Update AccountingTab.tsx

| Section | Change |
|---------|--------|
| Type definition | Add `'ledger'` to `ChartView` type |
| Tab toggle buttons | Add third "Ledger" button after Commission |
| Conditional rendering | Add `{chartView === 'ledger' && <LedgerView ... />}` section |
| EOD date sharing | Reuse existing `selectedDate` state |

### 2. Create New Component: `LedgerView.tsx`

**Location:** `src/components/trade-history/LedgerView.tsx`

**Features:**
- 3 summary cards (Total Debit, Total Credit, Net Balance) matching existing card styling
- Searchable table with columns: Investor Code, Investor Name, Entry Type, Scrip, Qty, Rate, Trade Value, Commission, Debit, Credit, Balance
- Row click opens drill-down dialog

### 3. Create Drill-down Dialog: `InvestorLedgerDrilldown.tsx`

**Location:** `src/components/trade-history/InvestorLedgerDrilldown.tsx`

**Features:**
- Date range picker (From/To)
- Investor summary header
- Transaction table showing all ledger entries
- Daily balance area chart using Recharts
- Export to CSV functionality

## UI/Styling Requirements

All components will match the existing dark theme styling:
- Gradient cards with `from-{color}-500/20 via-{color}-500/10 to-transparent`
- Border colors with `border-{color}-500/30`
- Icon accent colors matching card themes
- Glass card effect using existing `glass-card` class
- Table styling with `hover:bg-muted/50` rows

## Data Flow

1. **Summary Cards**: Query `v_ledger_dashboard` view filtered by `selectedDate`
2. **Investor Table**: Call `get_ledger_by_date` RPC with date and optional search term
3. **Drill-down Transactions**: Call `get_investor_ledger` RPC with investor code and date range
4. **Balance Chart**: Call `get_investor_daily_balances` RPC with investor code and date range

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/xxx_add_ledger_views_and_functions.sql` | Create | Database view and RPC functions |
| `src/components/trade-history/LedgerView.tsx` | Create | Main ledger tab content component |
| `src/components/trade-history/InvestorLedgerDrilldown.tsx` | Create | Drill-down dialog for investor details |
| `src/components/trade-history/AccountingTab.tsx` | Modify | Add Ledger tab toggle and conditional render |
| `src/integrations/supabase/types.ts` | Auto-update | Types regenerated after migration |

## Technical Notes

1. **Role-based Security**: RPC functions use SECURITY DEFINER with internal role checks (per existing pattern in `get_accounting_data`)
2. **Pagination**: Table limited to 500 rows with search filtering to ensure performance
3. **Date Handling**: Uses `parseISO` from date-fns to avoid timezone issues (as established in recent fixes)
4. **Query Caching**: React Query with 5-minute staleTime matching existing patterns
