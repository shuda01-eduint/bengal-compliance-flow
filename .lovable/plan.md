
# Add Ledger Balance Column and Historical Date Selection to Margin Loan Client Accounts

## Overview
Enhance the Client Accounts tab in the Margin Loan Management page to:
1. Add a **Ledger Balance** column showing the actual closing balance (negative values for margin accounts)
2. Add a **date picker** to view margin account data for any historical date (currently only shows latest)
3. Use the stored `cumulative_interest` from EOD snapshots instead of dynamically calculating it

## Current State Analysis
- The `get_margin_client_accounts` RPC only fetches the **latest** EOD snapshot data
- It calculates accrued interest dynamically: `(interest_rate / 365 / 100) * ABS(ledger_balance) * 90`
- The stored `cumulative_interest` in `eod_ledger_snapshots` is not being used
- No date parameter exists to query historical data
- Table shows: Investor Code, Investor Name, RM Name, Margin Loan, Accrued Interest, Portfolio Value, Equity, Margin Ratio %, Status

## Implementation Plan

### Phase 1: Update Database RPC Function

Modify `get_margin_client_accounts` to:
- Accept a new `p_as_of_date` parameter (defaults to latest date if NULL)
- Return `ledger_balance` (closing_balance) as a new column
- Use stored `cumulative_interest` instead of calculating dynamically
- Query snapshots for the specified date instead of always using the latest

```sql
CREATE OR REPLACE FUNCTION public.get_margin_client_accounts(
  p_search text DEFAULT '',
  p_account_type text DEFAULT 'all',
  p_statuses text[] DEFAULT ARRAY['all'],
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0,
  p_as_of_date date DEFAULT NULL  -- NEW: Optional date parameter
)
RETURNS TABLE(
  investor_code text,
  investor_name text,
  rm_name text,
  account_type text,
  ledger_balance numeric,      -- NEW: Actual closing balance
  current_exposure numeric,
  accrued_interest numeric,
  portfolio_value numeric,
  equity numeric,
  margin_ratio numeric,
  status text
)
```

### Phase 2: Update Frontend Component

Modify `ClientAccountsTab.tsx`:

1. **Add Date Picker** in the filter section:
   - Add a date selector with calendar popup
   - Default to "Latest" (null) which uses the most recent EOD date
   - Show selected date or "Latest" label

2. **Add Ledger Balance Column** to the table:
   - Insert between "RM Name" and "Margin Loan"
   - Display the actual balance (negative for margin accounts)
   - Color-code: red for negative values

3. **Update Query** to pass the selected date:
   ```typescript
   const { data: accounts, isLoading, refetch } = useQuery({
     queryKey: ['margin-client-accounts', selectedStatuses, accountTypeFilter, searchTerm, selectedDate],
     queryFn: async () => {
       const { data, error } = await supabase.rpc('get_margin_client_accounts', {
         p_search: searchTerm,
         p_account_type: accountTypeFilter,
         p_statuses: selectedStatuses.includes("all") ? ["all"] : selectedStatuses,
         p_limit: 10000,
         p_offset: 0,
         p_as_of_date: selectedDate // NEW: Pass selected date
       });
       // ...
     }
   });
   ```

## UI Changes

### Filter Bar (Updated)
```
+------------------------------------------------------------------+
| [Search by investor code...]  [All Types v] [All Status v]       |
|                                                                  |
| [Date: Latest v] [Jan 28] (calendar popup)     [Refresh]         |
+------------------------------------------------------------------+
```

### Table Columns (Updated)
| Investor Code | Investor Name | RM Name | Ledger Balance | Margin Loan | Accrued Interest | Portfolio Value | Equity | Margin Ratio % | Status | Actions |

- **Ledger Balance**: Shows actual closing balance (e.g., "-৳67.37 Cr" for negative)
- **Margin Loan**: Shows absolute value of negative balance (exposure)
- **Accrued Interest**: Uses stored cumulative_interest from EOD snapshots

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/` | New migration to update `get_margin_client_accounts` RPC |
| `src/components/margin-loan/ClientAccountsTab.tsx` | Add date picker, ledger balance column, update query |
| `src/integrations/supabase/types.ts` | Auto-updates with new RPC signature |

## Technical Details

### RPC Function Changes
```sql
-- Key changes in the CTE:
snapshot_for_date AS (
  SELECT DISTINCT ON (els.investor_code)
    els.investor_code,
    els.investor_name,
    els.rm_name,
    els.account_type,
    els.closing_balance as ledger_balance,
    els.cumulative_interest,  -- Use stored value
    els.interest_rate,
    els.eod_date
  FROM eod_ledger_snapshots els
  WHERE (p_as_of_date IS NULL OR els.eod_date <= p_as_of_date)
  ORDER BY els.investor_code, els.eod_date DESC
),
portfolio_values AS (
  SELECT 
    ehs.investor_code,
    SUM(COALESCE(ehs.market_value, 0)) as total_portfolio_value
  FROM eod_holding_snapshots ehs
  WHERE ehs.eod_date = (
    SELECT MAX(eod_date) 
    FROM eod_holding_snapshots 
    WHERE (p_as_of_date IS NULL OR eod_date <= p_as_of_date)
  )
  GROUP BY ehs.investor_code
)
```

### Frontend Date State
```typescript
const [selectedDate, setSelectedDate] = useState<Date | null>(null); // null = Latest
```

## Expected Outcome

1. Users can view margin account data for any historical date
2. Ledger Balance column shows actual balance (helpful for seeing the sign)
3. Accrued Interest uses actual stored cumulative values
4. Default behavior remains "Latest" for backwards compatibility
