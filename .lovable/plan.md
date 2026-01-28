

## Fix EOD Deposits/Withdrawals Logic + Baseline Alignment

### Problem Summary

The `run_batch_eod` function produces incorrect closing balances because:

1. **Cumulative vs Daily**: Trade files store **cumulative** deposit/withdrawal totals, but the EOD engine uses them as if they were daily values
2. **Baseline Mismatch**: Investor 21519's baseline was imported incorrectly (462.28 vs -73.61)

### Data Evidence

| Date | Cumulative Deposits (trade_history) | Actual Daily Deposit (deposits_withdrawals) |
|------|-------------------------------------|---------------------------------------------|
| Jan 27 | 1,795,000 | 325,000 |
| Jan 28 | 2,120,000 | 0 (no deposit) |

The EOD engine is using 1,795,000 as the Jan 27 deposit instead of 325,000.

### Solution

**Option A: Use Delta Calculation (Recommended)**

Calculate daily deposits/withdrawals by comparing today's cumulative value with yesterday's:

```sql
-- Current (wrong):
SELECT 
  client_code,
  MAX(total_deposits) AS deposits,  -- Gets cumulative!
  MAX(total_withdrawals) AS withdrawals
FROM trade_history
WHERE trade_date = p_eod_date

-- Fixed (delta calculation):
WITH cumulative_today AS (
  SELECT client_code, MAX(total_deposits) AS cum_dep, MAX(total_withdrawals) AS cum_wdl
  FROM trade_history WHERE trade_date = p_eod_date
  GROUP BY client_code
),
cumulative_prev AS (
  SELECT client_code, MAX(total_deposits) AS cum_dep, MAX(total_withdrawals) AS cum_wdl
  FROM trade_history WHERE trade_date < p_eod_date
  GROUP BY client_code
)
SELECT 
  t.client_code,
  COALESCE(t.cum_dep, 0) - COALESCE(p.cum_dep, 0) AS deposits,  -- Daily delta
  COALESCE(t.cum_wdl, 0) - COALESCE(p.cum_wdl, 0) AS withdrawals
FROM cumulative_today t
LEFT JOIN cumulative_prev p ON p.client_code = t.client_code
```

**Option B: Use deposits_withdrawals Table**

Switch back to using the `deposits_withdrawals` table which has correct daily values:

```sql
daily_deposits AS (
  SELECT 
    investor_code,
    SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END) AS deposits,
    SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END) AS withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
  GROUP BY investor_code
)
```

### Recommendation: Hybrid Approach

Use **deposits_withdrawals** table as primary source (has correct daily values), with fallback to trade_history delta calculation for backwards compatibility.

### Implementation Steps

1. **Update `run_batch_eod` function**
   - Modify `daily_deposits` CTE to use delta calculation or deposits_withdrawals table
   - Keep ledger_balance_snapshot capture from trade_history for audit

2. **Fix baseline for affected investors**
   - Update investor 21519: `ledger_balance = -73.61`
   - Clear EOD snapshots from Jan 12 onward
   - Re-run batch EOD to rebuild the chain

3. **Validation**
   - Verify Jan 28 closing for 21519 matches source: `-710,722.99`

### Technical Details

**Migration SQL (deposits_withdrawals approach):**

```sql
-- Replace daily_deposits CTE
daily_deposits AS (
  SELECT 
    investor_code,
    COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) AS deposits,
    COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
  FROM deposits_withdrawals
  WHERE transaction_date = p_eod_date
  GROUP BY investor_code
),

-- Keep trade_history ledger snapshot for audit (separate CTE)
trade_ledger_snapshot AS (
  SELECT 
    client_code AS investor_code,
    MAX(ledger_balance_snapshot) AS ledger_snapshot
  FROM trade_history
  WHERE trade_date = p_eod_date
  GROUP BY client_code
)
```

### Risk Assessment

- **Low Risk**: Using deposits_withdrawals is the cleaner approach as it already has correct daily values
- **Data Integrity**: Must clear and re-run EOD for all affected dates after fixing
- **Verification**: Should validate against source system for multiple investors, not just 21519

