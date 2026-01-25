
# Fix: Restore Opening Balance from eod_ledger_snapshots

## Problem

The recent migration that fixed the commission calculation accidentally broke the opening balance. It reverted the data source from `eod_ledger_snapshots` back to `balances_raw`.

**Evidence:**
- Investor 10750 has **no data** in `balances_raw` table
- Investor 10750 **has correct data** in `eod_ledger_snapshots`:
  - 2026-01-21: closing_balance = 6512.76
  - 2026-01-22: closing_balance = 25.36 (correct after brokerage)

## Root Cause

In the migration `20260125115555_*.sql`, the `opening_balances` CTE incorrectly queries:

```sql
opening_balances AS (
  SELECT
    br.investor_code,
    COALESCE(br.ledger_balance, 0) AS opening_balance
  FROM public.balances_raw br                    -- WRONG: should be eod_ledger_snapshots
  WHERE br.as_of_date = _opening_date
    AND br.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
),
```

## Solution

Create a new migration to fix the `opening_balances` CTE to use `eod_ledger_snapshots`:

```sql
opening_balances AS (
  SELECT
    els.investor_code,
    COALESCE(els.closing_balance, els.ledger_balance, 0) AS opening_balance
  FROM public.eod_ledger_snapshots els
  WHERE els.eod_date = _opening_date
    AND els.investor_code IN (SELECT ib.investor_code FROM investor_base ib)
),
```

This uses `COALESCE(closing_balance, ledger_balance, 0)` as documented in the memory for the proper fallback chain.

---

## Technical Details

### Changes

**File to Create:** New database migration

**Scope:** Replace only the `opening_balances` CTE while keeping all other fixes intact (the commission calculation fix remains correct)

### Updated CTE Logic

| Field | Before (Wrong) | After (Correct) |
|-------|----------------|-----------------|
| Table | `balances_raw` | `eod_ledger_snapshots` |
| Date Column | `as_of_date` | `eod_date` |
| Value Column | `ledger_balance` | `COALESCE(closing_balance, ledger_balance, 0)` |

### Expected Result

After this fix:
- Investor 10750 on 2026-01-22 will show:
  - **Opening Bal:** 6,512.76 (from 2026-01-21 snapshot)
  - **Gross Buy:** 6,468.00
  - **Brokerage:** 19.40
  - **Closing Balance:** 25.36

### Verification Query

```sql
SELECT investor_code, opening_balance, gross_buy, brokerage, closing_balance
FROM get_accounting_data_v3('2026-01-21', '2026-01-22', '10750', 'all', 'with_trades', 10, 0);
```

Expected: opening_balance = 6512.76, closing_balance ≈ 25.36
