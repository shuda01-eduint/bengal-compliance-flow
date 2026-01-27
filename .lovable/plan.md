

## Update EOD Process for New Trade History Data Structure

### Summary
The trade import now embeds daily deposit/withdrawal aggregates and ledger balance snapshots directly in each trade record. The EOD process needs to be updated to source this data from `trade_history` instead of the `deposits_withdrawals` table, and to capture the `ledger_balance_snapshot` for verification purposes.

---

### Database Schema Change

**Add column to `eod_ledger_snapshots`:**
```sql
ALTER TABLE eod_ledger_snapshots 
ADD COLUMN IF NOT EXISTS ledger_balance_snapshot numeric DEFAULT 0;
```

This column will store the opening balance as reported in the trade file, allowing comparison with the calculated opening balance for reconciliation.

---

### RPC Function Update: `run_batch_eod`

**Current Behavior:**
- Reads deposits/withdrawals from `deposits_withdrawals` table
- Uses previous day's closing balance as opening balance

**New Behavior:**
- Read `total_deposits`, `total_withdrawals`, and `ledger_balance_snapshot` from `trade_history` (aggregated per client per day)
- Store `ledger_balance_snapshot` in the EOD snapshot for audit/verification

**Key Changes:**

1. **Replace `daily_deposits` CTE:**
```text
Before: Query deposits_withdrawals table
After:  Aggregate from trade_history for the EOD date
```

```sql
daily_deposits AS (
  SELECT 
    client_code AS investor_code,
    -- Take MAX since all rows have same value per client per day
    COALESCE(MAX(total_deposits), 0) AS deposits,
    COALESCE(MAX(total_withdrawals), 0) AS withdrawals,
    MAX(ledger_balance_snapshot) AS ledger_snapshot
  FROM trade_history
  WHERE trade_date = p_eod_date
  GROUP BY client_code
)
```

2. **Update snapshots CTE:**
   - Include `ledger_balance_snapshot` from `daily_deposits`

3. **Update INSERT statement:**
   - Add `ledger_balance_snapshot` column to INSERT and ON CONFLICT UPDATE

4. **Update universe CTE:**
   - Continue including `deposits_withdrawals` in universe for backwards compatibility with historical data

---

### Data Flow Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                     TRADE FILE UPLOAD                           │
│  Contains per-trade records with embedded client-level data:    │
│  • total_deposits (same for all trades of client on day)        │
│  • total_withdrawals (same for all trades of client on day)     │
│  • ledger_balance_snapshot (opening balance for day)            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      run_batch_eod()                            │
├─────────────────────────────────────────────────────────────────┤
│  1. Build universe of investors                                 │
│  2. Get previous day closing balance → opening_balance          │
│  3. Aggregate deposits/withdrawals from trade_history           │
│  4. Calculate: gross_buy, gross_sell, commission                │
│  5. Compute closing_balance using formula                       │
│  6. Store ledger_balance_snapshot for verification              │
│  7. Insert/upsert into eod_ledger_snapshots                     │
│  8. Capture holdings into eod_holding_snapshots                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   eod_ledger_snapshots                          │
├─────────────────────────────────────────────────────────────────┤
│  investor_code, eod_date, opening_balance, closing_balance,     │
│  total_deposits, total_withdrawals, gross_buy, gross_sell,      │
│  total_commission, ledger_balance_snapshot (NEW),               │
│  accrued_interest, cumulative_interest, ...                     │
└─────────────────────────────────────────────────────────────────┘
```

---

### Closing Balance Formula (unchanged)

```
Closing Balance = Opening Balance 
                + Deposits 
                - Withdrawals 
                + Gross Sell 
                - Gross Buy 
                - Commission
```

---

### Technical Implementation Steps

1. **Migration: Add column**
   - Add `ledger_balance_snapshot` column to `eod_ledger_snapshots`
   - Default to 0 for backwards compatibility

2. **Update `run_batch_eod` function:**
   - Modify `daily_deposits` CTE to query `trade_history`
   - Add `ledger_balance_snapshot` to snapshots calculation
   - Update INSERT/UPSERT to include new column
   - Keep `deposits_withdrawals` in universe CTE for historical compatibility

3. **Update frontend (if needed):**
   - No changes required to `BatchEodRunner.tsx` - the RPC interface remains compatible

---

### Backwards Compatibility

- For dates with no trade data but existing `deposits_withdrawals` records, the system will still capture investors in the universe
- Historical EOD snapshots will have `ledger_balance_snapshot = 0` (column default)
- No changes to the closing balance formula - only the data source changes

---

### Verification

After implementation:
- `ledger_balance_snapshot` should match `opening_balance` if the EOD chain is correct
- Any discrepancy indicates a data import issue or broken chain
- Can be used for reconciliation reporting

