

# RPC Timeout Optimization Plan

## Problem Analysis

Three RPC functions are experiencing intermittent 504 Gateway Timeout errors on the Accounting page:

1. `get_accounting_data_v3` - Primary data function (504 timeout after ~125s)
2. `get_accounting_turnover_by_department` - Department turnover chart (500 timeout)
3. `get_commission_by_department` - Commission by department chart (500 timeout)

### Key Findings

| Function | DB Execution Time | HTTP Timeout | Issue |
|----------|------------------|--------------|-------|
| get_accounting_data_v3 | ~213ms | ~125s | Gateway congestion + retry storms |
| get_turnover_by_department | ~80ms | ~120s | No statement_timeout set |
| get_commission_by_department | ~100ms | ~120s | No statement_timeout set |

**Root Causes:**
1. The functions execute quickly in the database but HTTP gateway occasionally congests
2. The retry logic in `rpcWithRetry` compounds the problem by sending 4 parallel requests
3. No explicit timeouts on the department aggregation functions
4. A date calculation bug causes opening balances to be fetched from wrong date

## Proposed Solution

### Phase 1: Fix Retry Logic (Frontend)

**File:** `src/components/trade-history/AccountingTab.tsx`

Stop retrying on timeout errors since they indicate gateway congestion, not transient failures:

```typescript
// In the useQuery for accounting data
retry: (failureCount, error: Error) => {
  const msg = error?.message || '';
  // Don't retry on timeout - it compounds the problem
  if (msg.includes('timeout') || msg.includes('504') || msg.includes('upstream')) return false;
  if (msg.includes('does not exist') || msg.includes('column')) return false;
  return failureCount < 1; // Only 1 retry for other errors
},
```

### Phase 2: Add Statement Timeouts to Department Functions (Database)

**SQL Migration:**

```sql
-- Add explicit 60s timeout to get_accounting_turnover_by_department
CREATE OR REPLACE FUNCTION public.get_accounting_turnover_by_department(
  _from_tx_date date DEFAULT NULL::date, 
  _to_tx_date date DEFAULT NULL::date
)
RETURNS TABLE(department text, total_buy numeric, total_sell numeric, turnover numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'  -- Add timeout
AS $function$
-- ... existing function body unchanged
$function$;

-- Add explicit 60s timeout to get_commission_by_department
CREATE OR REPLACE FUNCTION public.get_commission_by_department(
  _from_tx_date date DEFAULT NULL::date, 
  _to_tx_date date DEFAULT NULL::date
)
RETURNS TABLE(department text, total_commission numeric, total_turnover numeric, trade_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'  -- Add timeout
AS $function$
-- ... existing function body unchanged
$function$;
```

### Phase 3: Fix Opening Balance Date Logic (Database + Frontend Alignment)

The current code has a **double subtraction bug**:
- Frontend sends `_opening_date = fromDate - 1 day` (e.g., Jan 27 for Jan 28 selection)
- Database function does `eod_date = _opening_date - 1 day` (queries Jan 26!)

**Option A: Fix in Database (Recommended)**
Remove the extra day subtraction in the function:

```sql
-- In get_accounting_data_v3, change:
WHERE els.eod_date = (_opening_date - INTERVAL '1 day')::date

-- To:
WHERE els.eod_date = _opening_date
```

**Option B: Fix in Frontend**
Send `fromDate` directly instead of `subDays(fromDate, 1)`:

```typescript
// Change:
_opening_date: openingDateStr,  // Currently subDays(fromDate, 1)

// To:
_opening_date: startDateStr,    // Use fromDate directly
```

### Phase 4: Lazy Load Department Charts (Frontend)

Only fetch department data when the chart is visible:

```typescript
// Turnover query - only fetch when chart tab is active
const { data: departmentTurnover } = useQuery({
  queryKey: ['accounting-turnover-by-department', openingDateStr, endDateStr],
  queryFn: async () => { /* ... */ },
  enabled: chartView === 'margin',  // Only fetch when margin chart is selected
  staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
});

// Commission query - only fetch when commission chart is selected  
const { data: commissionByDept } = useQuery({
  queryKey: ['accounting-commission-by-department', openingDateStr, endDateStr],
  queryFn: async () => { /* ... */ },
  enabled: chartView === 'commission',  // Only fetch when commission chart is selected
  staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
});
```

## Technical Details

### Files to Modify

1. **`src/components/trade-history/AccountingTab.tsx`**
   - Update retry logic to not retry on timeouts
   - Fix date parameter naming (use `startDateStr` not `openingDateStr`)
   - Add `staleTime` to reduce redundant fetches
   - Ensure department chart queries only run when their chart is active

2. **Database Migration**
   - Add `SET statement_timeout TO '60s'` to department functions
   - Fix opening balance date logic in `get_accounting_data_v3`

### Expected Outcome

- Timeout errors will fail fast (60s) instead of hanging for 125s
- No retry storms during gateway congestion
- Opening balances will be fetched from the correct date
- Department charts will only load when needed, reducing concurrent requests

### Risk Assessment

- **Low Risk**: Changes are defensive and don't alter core business logic
- **Rollback**: If issues arise, the timeout settings can be reverted via another migration

