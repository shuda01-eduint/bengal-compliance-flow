
# Fix Withdrawals Calculation in run_batch_eod

## Problem Identified

The `run_batch_eod` function incorrectly calculates deposits and withdrawals by assuming:
- **Deposits** = positive amounts
- **Withdrawals** = negative amounts

But the `cash_ledger_txn` table stores ALL amounts as **positive values**, using the `type` column to distinguish between `DEPOSIT` and `WITHDRAW`.

| Current Data in cash_ledger_txn | |
|--------------------------------|---|
| DEPOSIT records | 201 rows, total: 338,239,927.57 BDT |
| WITHDRAW records | 167 rows, total: 168,795,365.17 BDT |
| All amounts | Positive values |

The current SQL logic:
```sql
-- WRONG: Checking amount sign
SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as deposits
SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as withdrawals
```

Should be:
```sql
-- CORRECT: Checking type column
SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END) as deposits
SUM(CASE WHEN type = 'WITHDRAW' THEN amount ELSE 0 END) as withdrawals
```

---

## Solution

Update the `run_batch_eod` function to use the `type` column for deposit/withdrawal classification in **two places**:

### 1. Summary Totals Calculation (lines 62-67)

**Before:**
```sql
SELECT 
  COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
INTO v_total_deposits, v_total_withdrawals
FROM cash_ledger_txn
WHERE txn_date = p_eod_date;
```

**After:**
```sql
SELECT 
  COALESCE(SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN UPPER(type) = 'WITHDRAW' THEN amount ELSE 0 END), 0)
INTO v_total_deposits, v_total_withdrawals
FROM cash_ledger_txn
WHERE txn_date = p_eod_date;
```

### 2. today_cash CTE (lines 97-105)

**Before:**
```sql
today_cash AS MATERIALIZED (
  SELECT
    investor_code,
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as deposits,
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date
  GROUP BY investor_code
)
```

**After:**
```sql
today_cash AS MATERIALIZED (
  SELECT
    investor_code,
    COALESCE(SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
    COALESCE(SUM(CASE WHEN UPPER(type) = 'WITHDRAW' THEN amount ELSE 0 END), 0) as withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_eod_date
  GROUP BY investor_code
)
```

---

## Expected Results After Fix

| Metric | Current | Expected |
|--------|---------|----------|
| Total Deposits | 0 | 338,239,927.57 BDT |
| Total Withdrawals | 0 | 168,795,365.17 BDT |
| Net Cash Flow | 0 | +169,444,562.40 BDT |
| EOD Summary Cards | Shows 0 for both | Shows correct values |
| eod_run_history record | zeros | populated correctly |

---

## Implementation

Create a database migration to update the `run_batch_eod` function with the corrected deposit/withdrawal logic.

---

## Verification Steps

1. Apply the migration
2. Re-run EOD for Feb 01, 2026 (single date mode, not skip existing)
3. Verify the EOD Summary cards show:
   - Deposits: ~338.2M BDT
   - Withdrawals: ~168.8M BDT  
   - Net Flow: +169.4M BDT
4. Check `eod_run_history` table for correct totals

---

## Technical Details

| Item | Change |
|------|--------|
| Database function | `public.run_batch_eod` |
| Migration file | New SQL migration |
| Logic change | Use `type` column instead of amount sign |
| Affected tables | `cash_ledger_txn` (read), `eod_run_history` (write), `eod_ledger_snapshots` (write) |
