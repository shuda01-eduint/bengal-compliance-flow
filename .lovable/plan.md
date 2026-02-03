

## Over Buy (Margin) Card Implementation Plan

### Overview
This plan implements the new "Over Buy (Margin)" violation detection logic that identifies margin accounts where the loan/liability has increased during the selected date range, indicating over-buying on margin.

### Business Logic
```text
+---------------------------+      +---------------------------+
|    Opening Balance        |      |    Closing Balance        |
|    (Start of Period)      |      |    (End of Period)        |
|    e.g., -100,000         | ---> |    e.g., -150,000         |
+---------------------------+      +---------------------------+
                                   
Loan Increase = ABS(-150,000) - ABS(-100,000) = 50,000
Condition: closing_balance < opening_balance (both negative)
```

---

### Implementation Steps

#### Step 1: Create RPC Function `get_over_buy_margin_codes`

Create a new database function that:
- Takes `p_from_date` and `p_to_date` parameters
- Compares the first date's balance with the last date's balance in the range
- Filters for `account_type = 'Margin'` only
- Excludes closed accounts via JOIN with `investors` table
- Returns accounts where the loan increased (closing more negative than opening)
- Calculates `loan_increase = ABS(closing_balance) - ABS(opening_balance)`
- Orders results by loan increase amount descending

**Return columns:**
- `client_code` (investor_code)
- `client_name` (from investors table)
- `rm_name` (from investors table)
- `opening_balance` (ledger_balance on first date in range)
- `closing_balance` (ledger_balance on last date in range)
- `loan_increase` (calculated increase amount)
- `first_date` (start of observation period)
- `last_date` (end of observation period)

#### Step 2: Update `useViolations` Hook

Modify `src/hooks/useViolations.ts`:
- Replace the existing `overBuyData` query (lines 85-116) with a call to the new RPC function
- Update the return type to include the new fields (opening_balance, closing_balance, loan_increase)
- Update summary calculation to sum `loan_increase` instead of the old amount calculation
- Update record mapping to use the new data structure

#### Step 3: Update ViolationRecord Interface

Extend the `ViolationRecord` interface in `ViolationsTable.tsx` to support additional fields:
- Add optional `opening_balance?: number`
- Add optional `closing_balance?: number` 
- Add optional `loan_increase?: number`

#### Step 4: Update ViolationsTable Component

Modify `src/components/violations/ViolationsTable.tsx` to display different columns based on violation type:
- When `over_buy` filter is active, show specialized columns:
  - Client Code (clickable)
  - Client Name
  - Opening Balance
  - Closing Balance
  - Loan Increase
  - RM Name
- For other violation types, keep the existing column structure

---

### Technical Details

#### Database Migration - RPC Function

```sql
CREATE OR REPLACE FUNCTION public.get_over_buy_margin_codes(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  client_code text,
  client_name text,
  rm_name text,
  opening_balance numeric,
  closing_balance numeric,
  loan_increase numeric,
  first_date date,
  last_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT 
      COALESCE(p_from_date, CURRENT_DATE - INTERVAL '30 days')::date as start_dt,
      COALESCE(p_to_date, CURRENT_DATE)::date as end_dt
  ),
  first_last_balances AS (
    SELECT 
      e.investor_code,
      FIRST_VALUE(e.ledger_balance) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as opening_bal,
      FIRST_VALUE(e.ledger_balance) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date DESC
      ) as closing_bal,
      FIRST_VALUE(e.eod_date) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as first_dt,
      FIRST_VALUE(e.eod_date) OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date DESC
      ) as last_dt,
      ROW_NUMBER() OVER (
        PARTITION BY e.investor_code 
        ORDER BY e.eod_date ASC
      ) as rn
    FROM eod_ledger_snapshots e
    CROSS JOIN date_range d
    WHERE LOWER(e.account_type) = 'margin'
      AND e.eod_date >= d.start_dt
      AND e.eod_date <= d.end_dt
  )
  SELECT 
    f.investor_code as client_code,
    COALESCE(i.investor_name, '') as client_name,
    COALESCE(i.rm_name, '') as rm_name,
    f.opening_bal as opening_balance,
    f.closing_bal as closing_balance,
    (ABS(f.closing_bal) - ABS(f.opening_bal)) as loan_increase,
    f.first_dt as first_date,
    f.last_dt as last_date
  FROM first_last_balances f
  LEFT JOIN investors i ON i.investor_code = f.investor_code
  WHERE f.rn = 1
    AND f.closing_bal < 0
    AND f.opening_bal < 0
    AND f.closing_bal < f.opening_bal  -- Loan increased (more negative)
    AND (i.status IS NULL OR UPPER(i.status) NOT IN ('CLOSED'))
  ORDER BY (ABS(f.closing_bal) - ABS(f.opening_bal)) DESC;
END;
$$;
```

#### Frontend Hook Changes

The `useViolations` hook will be updated to:
1. Call `get_over_buy_margin_codes` RPC instead of direct table query
2. Pass the date range parameters
3. Map response to include the new fields for display

#### Table Display Logic

The ViolationsTable will conditionally render columns:
- Default view: Event Date, Client Code, Client Name, Violation Type, Amount, RM Name
- Over Buy filtered view: Client Code, Client Name, Opening Balance, Closing Balance, Loan Increase, RM Name

---

### Files to be Modified

| File | Changes |
|------|---------|
| `supabase/migrations/[timestamp].sql` | New RPC function `get_over_buy_margin_codes` |
| `src/hooks/useViolations.ts` | Replace overBuy query with RPC call, update types |
| `src/components/violations/ViolationsTable.tsx` | Add conditional columns for over_buy type |

### Testing Considerations
- Verify that only margin accounts appear in the Over Buy card
- Confirm closed accounts are excluded
- Validate the loan_increase calculation matches expected values
- Test date range filtering works correctly
- Ensure the table displays correct columns when Over Buy filter is active

