

## Align Backend Opening Balance with Frontend Logic

### The Problem

**Current Backend Logic (line 79-86, 137):**
```sql
prev_balances AS (
  SELECT investor_code, closing_balance, cumulative_interest
  FROM eod_ledger_snapshots
  WHERE eod_date = v_prev_date  -- EXACT DATE MATCH ONLY
),
...
COALESCE(pb.closing_balance, 0) AS opening_balance  -- Falls back to 0
```

**Current Frontend Logic (already simplified):**
```typescript
// Uses lte + order desc to find MOST RECENT snapshot
.lte('eod_date', dateStr)
.order('eod_date', { ascending: false })
.limit(1)

// Falls back to investors.ledger_balance, then 0
```

### The Fix

Update `prev_balances` CTE to find the **most recent EOD snapshot** before the target date, then fall back to `investors.ledger_balance` instead of `0`:

```sql
-- Previous day closing balances (use most recent available, not exact date)
prev_balances AS (
  SELECT DISTINCT ON (investor_code)
    investor_code,
    closing_balance,
    cumulative_interest
  FROM eod_ledger_snapshots
  WHERE eod_date < p_eod_date  -- Any date before EOD date
  ORDER BY investor_code, eod_date DESC  -- Get most recent per investor
),

-- Opening balance assignment (with fallback chain)
...
COALESCE(pb.closing_balance, i.ledger_balance, 0) AS opening_balance
```

### Comparison Table

| Aspect | Current Backend | Proposed Backend | Frontend |
|--------|-----------------|------------------|----------|
| Lookup | `= v_prev_date` (exact) | `< p_eod_date` + `DESC LIMIT 1` | `lte` + `order desc` |
| 1st Fallback | None (skips to 0) | `investors.ledger_balance` | `investors.ledger_balance` |
| 2nd Fallback | `0` | `0` | `0` |

### Migration SQL

```sql
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $$
DECLARE
  -- ... existing declarations ...
BEGIN
  -- ... existing security checks ...
  
  WITH 
  universe AS (
    -- ... existing universe logic ...
  ),
  
  -- UPDATED: Previous balances with flexible date lookup
  prev_balances AS (
    SELECT DISTINCT ON (investor_code)
      investor_code,
      closing_balance,
      cumulative_interest
    FROM eod_ledger_snapshots
    WHERE eod_date < p_eod_date
    ORDER BY investor_code, eod_date DESC
  ),
  
  -- ... existing daily_deposits, daily_trades CTEs ...
  
  snapshots AS (
    SELECT 
      u.investor_code,
      -- ... other fields ...
      -- UPDATED: Fallback chain for opening balance
      COALESCE(pb.closing_balance, im.ledger_balance, 0) AS opening_balance,
      -- ... rest of calculations using new opening_balance ...
    FROM universe u
    LEFT JOIN prev_balances pb ON pb.investor_code = u.investor_code
    LEFT JOIN daily_deposits dd ON dd.investor_code = u.investor_code
    LEFT JOIN daily_trades dt ON dt.investor_code = u.investor_code
    LEFT JOIN investor_meta im ON im.investor_code = u.investor_code
  ),
  -- ... rest of function ...
```

### Changes Summary

1. **`prev_balances` CTE**: 
   - Change `WHERE eod_date = v_prev_date` → `WHERE eod_date < p_eod_date`
   - Add `DISTINCT ON (investor_code)` with `ORDER BY investor_code, eod_date DESC`

2. **`snapshots` CTE**:
   - Add `i.ledger_balance` to `investor_meta` select
   - Change `COALESCE(pb.closing_balance, 0)` → `COALESCE(pb.closing_balance, im.ledger_balance, 0)`

3. **Closing balance calculation**:
   - Uses the new `opening_balance` which now has proper fallback

### Benefits

- **Frontend/Backend alignment**: Both use same fallback chain
- **Gap resilience**: Missing EOD dates won't break calculations
- **Proper baseline**: Uses imported `ledger_balance` for accounts without EOD history
- **New accounts**: Still defaults to `0` only when truly no data exists

