

# Fix: Doubled EOD Metrics from Duplicate Trade Imports

## Problem Diagnosis
February 1st `trade_file` staging data contains **69,329 records but only 21,626 unique trades** — a ~3.2x duplication. The processing function is mathematically correct, but the source data is bloated. The "Clear Selected" button only clears EOD results, not the staging data that feeds them.

## Solution Overview
1. **Extend the clear function** to also delete staging data (`trade_file`, `cash_ledger_txn`) for the selected date range
2. **Provide a deduplication query** to fix the current Feb 1 data without requiring a full re-import

---

## Technical Changes

### Change 1: Update `clear_eod_by_date_range` Function

The current function only clears output tables. It will be updated to also clear staging tables when EOD data is deleted:

| Current Behavior | New Behavior |
|-----------------|--------------|
| Deletes `eod_ledger_snapshots` | Deletes `eod_ledger_snapshots` |
| Deletes `eod_run_history` | Deletes `eod_run_history` |
| — | Deletes `eod_instrument_position` |
| — | Deletes `trade_file` for the date range |
| — | Deletes `cash_ledger_txn` for the date range |

This ensures that after "Clear Selected", re-importing trades will start fresh.

### Change 2: One-Time Deduplication Query

To fix the current bloated Feb 1 data without re-importing, a deduplication query will be provided that:
1. Identifies truly unique trades using a composite key (investor, instrument, side, qty, price, settlement_date, exchange_code)
2. Keeps only one copy of each unique trade
3. Deletes the duplicates (~47,000 excess records)

```text
Deduplication Strategy:
┌─────────────────────────────────────────────────────────────┐
│  69,329 total  →  Delete 47,703 duplicates  →  21,626 kept │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Update Database Function
Create a migration to update `clear_eod_by_date_range`:
- Add deletion of `eod_instrument_position` for the date range
- Add deletion of `trade_file` for the date range  
- Add deletion of `cash_ledger_txn` for the date range
- Return counts of all deleted records in the response

### Step 2: Run Deduplication for Feb 1
Execute a SQL script to remove duplicate trades from `trade_file` for 2026-02-01 while preserving one copy of each unique trade.

### Step 3: Re-process EOD
After deduplication, re-run "Process Staged Trades" for Feb 1. Expected corrected metrics:
- Trade count: ~21,626 (down from 69,329)
- Gross Buy: ~৳1.4B (down from ~৳4.5B)
- Gross Sell: ~৳1.3B (down from ~৳4.1B)
- Commission: ~৳4-6M (calculated from corrected trades)

---

## Files Modified

| File | Change |
|------|--------|
| Database Migration | Update `clear_eod_by_date_range` to include staging tables |
| Database (data) | Deduplication query run once against `trade_file` |

---

## Workflow After Implementation

1. Click "Clear Selected" for a date → Clears ALL data (results + staging)
2. Re-import trades → Fresh DSE/CSE files
3. Import deposits/withdrawals → Fresh data
4. Process Staged Trades → Accurate metrics

