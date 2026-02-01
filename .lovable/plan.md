

## Plan: Fix Column Name Mismatch in `run_batch_eod` RETURNING Clause

### Problem Analysis

After thorough investigation, I found the root cause of the February 1st EOD failure:

**The `RETURNING` clause in `run_batch_eod` uses `deposits` and `withdrawals`, but the `eod_ledger_snapshots` table columns are named `total_deposits` and `total_withdrawals`.**

Looking at the latest migration (lines 190-202):

```sql
INSERT INTO eod_ledger_snapshots (
  ...
  total_deposits,      -- ← Table column name
  total_withdrawals,   -- ← Table column name
  ...
)
SELECT
  ...
  wi.deposits,         -- ← CTE alias
  wi.withdrawals,      -- ← CTE alias
  ...
FROM with_interest wi
RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission, deposits, withdrawals
                                                                                   ^^^^^^^^  ^^^^^^^^^^^
                                                                                   ERROR: These don't exist!
```

The INSERT correctly maps `wi.deposits` to `total_deposits`, but the RETURNING clause tries to reference `deposits` which is not a column in the table.

### Settlement Calculation Check

The "Calculate Settlements" feature was **NOT** the cause of this issue:
- It only queries `trade_file` for read-only settlement calculations
- It aggregates buy/sell values by investor code  
- It does not write to any EOD-related tables
- Safe to use without impact on EOD processing

---

### Technical Solution

Update the `RETURNING` clause to use the correct column names that exist in `eod_ledger_snapshots`:

| Current (Broken) | Correct (Fixed) |
|------------------|-----------------|
| `deposits` | `total_deposits` |
| `withdrawals` | `total_withdrawals` |

### Files to Modify

| File | Change |
|------|--------|
| SQL Migration | Fix `run_batch_eod` RETURNING clause column names |

### SQL Migration

```sql
-- Fix run_batch_eod RETURNING clause to use correct column names
CREATE OR REPLACE FUNCTION public.run_batch_eod(...)

-- Change line 202 from:
RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission, deposits, withdrawals

-- To:
RETURNING investor_code, closing_balance, gross_buy, gross_sell, total_commission, total_deposits, total_withdrawals

-- Also update lines 210-211 aggregation to match:
COALESCE(SUM(total_deposits), 0),
COALESCE(SUM(total_withdrawals), 0)
```

---

### Post-Implementation

1. Clear the Feb 1 EOD data (if any partial run exists)
2. Re-run EOD for Feb 1 to verify the fix

