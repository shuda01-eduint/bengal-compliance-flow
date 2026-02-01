

# Fix Commission Calculation in run_batch_eod

## Problem Identified

The Accounting page shows "No commission data available" for Feb 01, 2026 because:

| Issue | Current State | Expected |
|-------|--------------|----------|
| `trade_file.commission` column | Always 0 (source files don't contain commission) | N/A |
| `eod_ledger_snapshots.total_commission` | 0 for all 32,846 investors | Should be ~6.7M BDT |
| `run_batch_eod` logic | Reads commission from file: `SUM(commission)` | Should calculate from investor rates |

The `process_staged_trades` function correctly calculates commission, but `run_batch_eod` (which is used for batch EOD processing) does not - it simply reads the zeroed `commission` column from `trade_file`.

## Root Cause

In `run_batch_eod`, the `today_trades` CTE uses:
```sql
SUM(COALESCE(commission, 0)) as total_commission
FROM trade_file
```

This reads commission from the file, which is always 0.

## Solution

Update the `run_batch_eod` function to calculate commission using the investor's `brokerage_commission` rate with the same normalization logic used in `process_staged_trades`:

```sql
-- Rate normalization:
-- >= 0.1: divide by 100 (e.g., 0.4 -> 0.004)
-- < 0.1 and > 0: use directly (e.g., 0.004 -> 0.004)
-- NULL: default to 0.004 (0.4%)
```

## Implementation

### Database Migration

Update the `today_trades` CTE in `run_batch_eod`:

**Before (lines 77-87):**
```sql
today_trades AS MATERIALIZED (
  SELECT
    investor_code,
    SUM(CASE WHEN UPPER(side) = 'SELL' THEN COALESCE(qty * price, 0) ELSE 0 END) as gross_sell,
    SUM(CASE WHEN UPPER(side) = 'BUY' THEN COALESCE(qty * price, 0) ELSE 0 END) as gross_buy,
    SUM(COALESCE(commission, 0)) as total_commission
  FROM trade_file
  WHERE trade_date = p_eod_date
    AND investor_code IS NOT NULL
  GROUP BY investor_code
)
```

**After:**
```sql
today_trades AS MATERIALIZED (
  SELECT
    tf.investor_code,
    SUM(CASE WHEN UPPER(tf.side) = 'SELL' THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) as gross_sell,
    SUM(CASE WHEN UPPER(tf.side) = 'BUY' THEN COALESCE(tf.qty * tf.price, 0) ELSE 0 END) as gross_buy,
    -- Calculate commission from investor's brokerage_commission rate
    SUM(
      COALESCE(tf.qty * tf.price, 0) *
      CASE
        WHEN i.brokerage_commission >= 0.1 THEN i.brokerage_commission / 100
        WHEN i.brokerage_commission < 0.1 AND i.brokerage_commission > 0 THEN i.brokerage_commission
        ELSE 0.004
      END
    ) as total_commission
  FROM trade_file tf
  LEFT JOIN investors i ON tf.investor_code = i.investor_code
  WHERE tf.trade_date = p_eod_date
    AND tf.investor_code IS NOT NULL
  GROUP BY tf.investor_code
)
```

## Expected Results After Fix

| Metric | Current | Expected |
|--------|---------|----------|
| Total Commission (Feb 01) | 0 | ~6.75M BDT (0.4% of ~1.69B turnover) |
| Commission per investor | 0 | Varies by rate (0.2% - 0.5%) |
| Accounting page commission chart | "No data" | Pie chart with department breakdown |

## Verification Steps

1. After migration, re-run EOD for Feb 01, 2026
2. Check `eod_ledger_snapshots` for non-zero `total_commission` values
3. Verify Accounting page shows commission data in the pie chart
4. Confirm `eod_run_history.total_commission` is populated

## Files Changed

| File | Change |
|------|--------|
| New migration | Update `run_batch_eod` function with commission calculation |

