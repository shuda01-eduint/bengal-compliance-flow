
# Fix: EOD Deposit/Withdrawal Calculation Bug

## Problem Identified

The `run_batch_eod` function incorrectly calculates daily deposits when there are gaps in trade data. This causes cumulative values to be treated as daily deltas.

### Root Cause Analysis

| Date | Actual Daily Deposit | Trade History Delta | DW Table | EOD Used | Issue |
|------|---------------------|---------------------|----------|----------|-------|
| Jan 18 | 0 | 995,000 (gap: no prev day) | NULL | 995,000 | **BUG** - cumulative treated as daily |
| Jan 20 | 0 | 800,000 (1.795M - 0.995M) | NULL | 800,000 | **BUG** - wrong delta due to gap |

The current logic:
```sql
GREATEST(dw_deposits, th_deposits_delta)
```

Picks the trade history delta when `deposits_withdrawals` has no record, but that delta is wrong when there's a gap in trade dates.

### Impact on Investor 21519

- **Stored closing balance**: 56.55 lac
- **Correct closing balance**: -6.97 lac (negative = receivable)
- **Error**: ~63.5 lac overstatement due to deposit inflation

## Solution

### Phase 1: Fix Delta Calculation Logic

Change the priority order - only use trade history delta as a fallback when deposits_withdrawals is unavailable **AND** the delta is positive (indicates real activity, not gap artifact).

```sql
-- Current buggy logic:
GREATEST(dw_deposits, th_deposits)

-- Fixed logic - prefer deposits_withdrawals, validate trade history deltas:
CASE 
  WHEN COALESCE(dw.deposits, 0) > 0 THEN dw.deposits
  WHEN th_deposits > 0 AND pdt.prev_deposits IS NOT NULL THEN th_deposits  
  ELSE 0  -- No valid source, assume zero
END
```

Actually, the better fix is to **always prefer `deposits_withdrawals`** and only use trade history as supplementary validation:

```sql
-- Simplified fix: deposits_withdrawals is the source of truth for daily transactions
COALESCE(dw.deposits, 0) as total_deposits,
COALESCE(dw.withdrawals, 0) as total_withdrawals,
```

### Phase 2: Fix Investor 21519 Data

After fixing the function, we need to:

1. Clear EOD snapshots for investor 21519 from Jan 12 onwards
2. Re-run Batch EOD for the full date range

```sql
-- Clear existing incorrect snapshots
DELETE FROM eod_ledger_snapshots 
WHERE investor_code = '21519' AND eod_date >= '2026-01-12';

-- Then re-run Batch EOD via the UI
```

## Technical Implementation

### Database Migration

```sql
CREATE OR REPLACE FUNCTION public.run_batch_eod(p_eod_date date, p_skip_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '300s'
AS $function$
-- ... existing declarations ...

BEGIN
  -- ... existing security and cleanup logic ...

  WITH 
  -- ... existing CTEs for prev_day_totals, today_totals, today_trades ...
  
  -- Deposit/withdrawal deltas from deposits_withdrawals table (case-insensitive)
  dw_deltas AS MATERIALIZED (
    SELECT
      investor_code,
      SUM(CASE WHEN LOWER(transaction_type) = 'deposit' THEN amount ELSE 0 END) as deposits,
      SUM(CASE WHEN LOWER(transaction_type) = 'withdrawal' THEN amount ELSE 0 END) as withdrawals
    FROM deposits_withdrawals
    WHERE transaction_date = p_eod_date
    GROUP BY investor_code
  ),
  
  -- ... existing universe and prev_closing CTEs ...
  
  final_calc AS (
    SELECT
      u.investor_code,
      -- ... existing columns ...
      
      -- FIX: Use deposits_withdrawals as primary source, not GREATEST()
      COALESCE(dw.deposits, 0) as daily_deposits,
      COALESCE(dw.withdrawals, 0) as daily_withdrawals,
      
      -- Trade history delta kept for audit/validation only
      CASE 
        WHEN pdt.prev_deposits IS NOT NULL 
        THEN COALESCE(tt.today_deposits, 0) - pdt.prev_deposits
        ELSE 0 
      END as th_deposits_delta,
      
      -- ... rest of columns ...
    FROM universe u
    -- ... existing JOINs ...
  )
  INSERT INTO eod_ledger_snapshots (...)
  SELECT
    p_eod_date,
    investor_code,
    -- ... existing columns ...
    
    -- FIX: Use daily_deposits/withdrawals from deposits_withdrawals, not GREATEST
    daily_deposits as total_deposits,
    daily_withdrawals as total_withdrawals,
    
    -- FIX: Closing balance uses correct daily values
    opening_balance 
      + daily_deposits 
      - daily_withdrawals
      + gross_sell 
      - gross_buy 
      - total_commission as closing_balance,
    
    -- ... rest of insert ...
  FROM final_calc;
  
  -- ... rest of function ...
END;
$function$;
```

### Files to Modify

1. **Database Migration**: Update `run_batch_eod` function to use `deposits_withdrawals` as the sole source for daily deposit/withdrawal values

2. **Data Correction**: After migration, clear and rebuild EOD chain for affected investors

## Expected Outcome

- Investor 21519 Jan 28 closing balance: **-6.97 lac** (correct negative balance)
- No more deposit inflation from trade history gaps
- EOD chain integrity maintained

## Risk Assessment

- **Medium Risk**: This changes core EOD calculation logic
- **Mitigation**: The fix makes the source of truth clearer (deposits_withdrawals table)
- **Rollback**: If issues arise, revert migration and clear/rebuild EOD data
