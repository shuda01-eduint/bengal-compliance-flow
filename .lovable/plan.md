
# Fix: Accounting Page Closing Balance Commission Calculation

## Problem Identified

The `get_accounting_data_v3` RPC function has a bug in the commission calculation. It's summing the `brokerage_commission` column from `trade_history`, but this column contains the **commission rate** (e.g., 0.3 meaning 0.3%), not the actual **commission amount**.

**Example - Investor 10750 on Jan 22, 2026:**
| Field | Value |
|-------|-------|
| Trade Value | 6,468 |
| Commission Rate | 0.3 (stored in DB) |
| Expected Commission | 6,468 × 0.3% = 19.40 |
| Actual Commission Used | 0.3 (wrong!) |
| Expected Closing Balance | 6,512.76 - 6,468 - 19.40 = **25.36** |
| Actual Closing Balance | 6,512.76 - 6,468 - 0.3 = **44.46** |

## Solution

Modify the `period_trades` CTE in the RPC to calculate the commission amount properly:

**Current Code (Wrong):**
```sql
COALESCE(SUM(COALESCE(th.brokerage_commission, 0)), 0) AS brokerage,
```

**Fixed Code:**
```sql
COALESCE(SUM(
  COALESCE(th.value, 0) * 
  COALESCE(th.brokerage_commission, 0.3) / 100
), 0) AS brokerage,
```

## Technical Details

### File to Modify
- New database migration to update the `get_accounting_data_v3` function

### Changes in the Function

1. **Period Trades CTE** (line 67 of current function):
   - Change from summing the rate directly to calculating: `value × rate / 100`
   - Handle NULL rates by defaulting to 0.3%
   - Handle rates stored as percentages (≥0.1) vs decimals (<0.1)

2. **Commission Normalization Logic**:
   ```sql
   -- If rate >= 0.1, treat as percentage (e.g., 0.3 = 0.3%)
   -- If rate < 0.1, treat as decimal (e.g., 0.003 = 0.3%)
   CASE 
     WHEN COALESCE(th.brokerage_commission, 0.3) >= 0.1 
     THEN COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.3) / 100
     ELSE COALESCE(th.value, 0) * COALESCE(th.brokerage_commission, 0.003)
   END
   ```

## Expected Outcome

After the fix:
- Investor 10750's closing balance for Jan 22 will show **25.36** (matching the expected value of ~19, accounting for rounding)
- All other investors' closing balances will also be corrected
- The exported CSV will contain the correct values since it uses the same data source

## Verification

After deployment, verify by checking:
1. Investor 10750 on Jan 22 should show closing balance ≈ 25.36
2. The commission column (if visible) should show ≈ 19.40
3. Cross-check with EOD snapshots which have the correct values
