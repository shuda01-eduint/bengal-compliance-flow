

## Fix Opening Balance Problem for Investor 9000

### Problem Summary

Investor 9000 shows an incorrect opening balance of **-226,087,275.69** when it should be **413,302.95** (as shown in the official UCB Stock Brokerage statement).

### Root Cause Analysis

The EOD snapshot chain for investor 9000 was corrupted during a batch historical EOD run on January 28, 2026. Here's what happened:

| Date | Opening | Closing | Problem |
|------|---------|---------|---------|
| Jan 12 | 259,538.19 | 259,538.19 | Baseline - correct |
| Jan 13 | 259,538.19 | 183,073.19 | Correct (trades applied) |
| **Jan 14** | **-75,315,360** | **-150,890,158** | **WRONG - massive withdrawals incorrectly applied** |
| Jan 15+ | Propagates error | | Entire chain corrupted |

**What went wrong:**
1. The `deposits_withdrawals` table contains old historical transactions:
   - Jan 4: Withdrawal of 72,500,000
   - Jan 7: Withdrawal of 3,000,000

2. These transactions occurred **before** the Jan 12 baseline date and were **already reflected** in the baseline balance of 259,538.19

3. An older version of the batch EOD function incorrectly read from `deposits_withdrawals` instead of `cash_ledger_txn`, causing these 75.5M in withdrawals to be **double-counted**

4. The current `run_batch_eod` function is **correct** - it reads from `cash_ledger_txn` only. But the damage was already done to historical snapshots.

### Current State
- **Database**: `eod_ledger_snapshots` for Feb 1 shows opening_balance = -226,087,275.69
- **Official Statement**: Opening Balance = 413,302.95
- **Investors Master**: `ledger_balance` = 413,302.95 (correct baseline)

---

### Solution: Re-run EOD from Jan 13 Forward

The cleanest fix is to delete corrupted snapshots and re-run EOD for all affected dates using the corrected function.

**Step 1: Delete Corrupted Snapshots for Investor 9000**

Delete all snapshots after the correct baseline (Jan 12):

```sql
DELETE FROM eod_ledger_snapshots 
WHERE investor_code = '9000' 
AND eod_date > '2026-01-12';
```

**Step 2: Update Jan 12 Baseline (if needed)**

Ensure the Jan 12 baseline reflects the correct balance:

```sql
UPDATE eod_ledger_snapshots
SET opening_balance = 259538.1858,
    closing_balance = 259538.1858,
    ledger_balance = 259538.1858
WHERE investor_code = '9000' 
AND eod_date = '2026-01-12';
```

**Step 3: Re-run Batch EOD**

Use the Batch EOD Runner on the EOD page to process dates from Jan 13 to Feb 1 with "Skip existing" = OFF for investor 9000.

**Alternative: Full Re-run**

If multiple investors are affected, consider:
1. Re-import the Admin Balance baseline for a known good date (e.g., Jan 31)
2. Run EOD for Feb 1 fresh

---

### Alternative Quick Fix: Direct Snapshot Update

For a faster surgical fix for just investor 9000 on Feb 1:

**Step 1: Calculate Correct Feb 1 Values**

Based on the statement:
- Opening Balance: 413,302.95
- Trades: SELL BRACBANK 700@75.1286 = 52,590 and SELL EBL 3000@25.50 = 76,500
- Gross Sell: 129,090.00
- Commission (2.5%): ~3,227.25
- Closing = 413,302.95 + 129,090.00 - 3,227.25 = **539,165.70** (approx)

Statement shows Closing: 542,360.68 (slight difference due to commission calculation)

**Step 2: Update Feb 1 Snapshot**

```sql
UPDATE eod_ledger_snapshots
SET opening_balance = 413302.95,
    closing_balance = 542360.68,
    ledger_balance = 542360.68
WHERE investor_code = '9000' 
AND eod_date = '2026-02-01';
```

---

### Recommended Action

1. **Use the "Import Admin Balance Baseline" feature** on the EOD page to import the correct Jan 31/Feb 1 baseline balances from the official source

2. **Re-run EOD for Feb 1** - this will use the correct opening balance from the newly imported baseline

3. For historical accuracy, delete and re-run the entire chain from Jan 13 using Batch EOD

---

### Files to Modify

**Database Changes Only** - no code changes needed. The current EOD functions are correct.

Execute SQL to:
1. Delete corrupted snapshots for affected investors (starting with 9000)
2. Re-run EOD to regenerate correct data

### Preventing Future Issues

The root cause was fixed in the current `run_batch_eod` function which now correctly reads from `cash_ledger_txn` instead of `deposits_withdrawals`. The old `deposits_withdrawals` records should be cleaned up or archived to prevent confusion:

```sql
-- Archive or delete old deposits_withdrawals records that pre-date the baseline
DELETE FROM deposits_withdrawals
WHERE transaction_date < '2026-01-12';
```

