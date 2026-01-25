
# Plan: Replace Mock Data with Real Margin Client Data

## Problem Identified
The "Client Margin Accounts" tab is displaying hardcoded mock data (INV001-INV005) because:
1. The `margin_accounts` table is **empty** (0 rows)
2. The component falls back to mock data when no accounts are found
3. Real data exists in `margin_equity_snapshots` view with **5,464 margin clients**

## Solution
Replace the `margin_accounts` query with a server-side RPC function that fetches real data from `margin_equity_snapshots`.

---

## Implementation Steps

### Step 1: Create RPC Function for Client Accounts
Create `get_margin_client_accounts` that fetches paginated, searchable margin accounts from the snapshots:

```sql
CREATE OR REPLACE FUNCTION get_margin_client_accounts(
  p_search text DEFAULT '',
  p_account_type text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  investor_code text,
  investor_name text,
  account_type text,
  rm_name text,
  department_name text,
  current_exposure numeric,
  portfolio_value numeric,
  equity numeric,
  margin_ratio numeric,
  margin_utilization numeric,
  status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mes.investor_code,
    i.investor_name,
    COALESCE(i.account_type, 'Margin') as account_type,
    mes.rm_name,
    mes.department_name,
    ABS(mes.ledger_closing_balance) as current_exposure,
    mes.total_portfolio_value as portfolio_value,
    mes.equity,
    (mes.equity / NULLIF(ABS(mes.ledger_closing_balance), 0)) * 100 as margin_ratio,
    (ABS(mes.ledger_closing_balance) / NULLIF(mes.total_portfolio_value, 0)) * 100 as margin_utilization,
    'active'::text as status
  FROM margin_equity_snapshots mes
  LEFT JOIN investors i ON i.investor_code = mes.investor_code
  WHERE mes.eod_date = (SELECT MAX(eod_date) FROM eod_ledger_snapshots)
    AND mes.ledger_closing_balance < 0
    AND (p_search = '' OR mes.investor_code ILIKE '%' || p_search || '%')
    AND (p_account_type = 'all' OR LOWER(COALESCE(i.account_type, 'margin')) = LOWER(p_account_type))
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

### Step 2: Update ClientAccountsTab.tsx

**Remove mock data fallback (lines 82-91):**
```typescript
// Delete these lines:
const mockAccounts = [...];
const displayData = accounts && accounts.length > 0 ? accounts : mockAccounts;
```

**Replace query with RPC call:**
```typescript
const { data: accounts, isLoading, refetch } = useQuery({
  queryKey: ['margin-client-accounts', statusFilter, accountTypeFilter, searchTerm],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('get_margin_client_accounts', {
      p_search: searchTerm,
      p_account_type: accountTypeFilter,
      p_limit: 100
    });
    if (error) throw error;
    return data || [];
  }
});
```

**Update table columns to match new data structure:**
- Investor Code (investor_code)
- Investor Name (investor_name) - NEW
- Account Type (account_type)
- RM Name (rm_name) - NEW
- Current Exposure (current_exposure)
- Portfolio Value (portfolio_value)
- Margin Ratio (margin_ratio)
- Status badge

---

## Expected Result

| Before (Mock) | After (Real Data) |
|---------------|-------------------|
| INV001 | 1363 - Tamjid Khan's client with ৳67.37 Cr exposure |
| INV002 | 3844 - Qazi Salman Ghyas's client with ৳43.69 Cr exposure |
| INV003 | 7022 - Md. Atiqur Rahman's client |
| 5 rows | 5,464 real margin clients |

---

## Files to Change
1. **New migration**: Create `get_margin_client_accounts` RPC function
2. **Edit `ClientAccountsTab.tsx`**: Use RPC, remove mock data, update table columns

## Technical Notes
- The RPC uses server-side filtering for search and account type
- Pagination support with p_limit and p_offset parameters
- Status is derived (all active margin accounts are "active")
- Joins with `investors` table to get investor names and account types
