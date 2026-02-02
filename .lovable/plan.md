

# Fix Commission/Data Mismatch in Accounting Page

## Problem Identified

The Accounting page shows different totals than expected because:

1. **Missing Investor Master Records**: 1,287 trades (~BDT 61.7M) on Feb 02 are from investor codes that don't exist in the `investors` master table
2. **Snapshot-Only Capture**: The `process_staged_trades` function only creates `eod_ledger_snapshots` for investors that exist in the `investors` table
3. **History vs Snapshot Mismatch**: `eod_run_history` records totals from ALL staging data, but `eod_ledger_snapshots` only has matched investors

### Data Comparison for Feb 02, 2026

| Metric | eod_run_history | eod_ledger_snapshots | Difference |
|--------|-----------------|----------------------|------------|
| Gross Buy | 696.9M | 654.0M | -42.9M (missing) |
| Gross Sell | 691.1M | 672.3M | -18.8M (missing) |
| Commission | 4.47M | 4.22M | -246K (missing) |
| Deposits | 113.3M | 82.5M | -30.9M (missing) |
| Withdrawals | 34.0M | 33.0M | -1.0M (missing) |

### Missing Investor Examples

Top unmatched investor codes with trades:
- 14255: 19.9M (single trade)
- 22339: 2.9M
- 9999: 2.9M
- GCML5689: 2.6M
- 22569: 2.6M

---

## Solution Options

### Option A: Add Missing Investors to Master Table (Recommended)

Import the missing investor codes into the `investors` table so they're captured in EOD snapshots.

**Steps:**
1. Create a query to identify all investor codes in staging tables not in investors master
2. Auto-generate investor records with default values for missing codes
3. Re-run EOD processing to capture all data

### Option B: Modify EOD Processing to Auto-Create Missing Investors

Update `process_staged_trades` to automatically create placeholder investor records for any investor_code found in trades/deposits that doesn't exist in the master table.

**Implementation:**
```sql
-- Before processing, insert missing investors with defaults
INSERT INTO investors (investor_code, investor_name, brokerage_commission)
SELECT DISTINCT 
  tf.investor_code,
  'Auto-created: ' || tf.investor_code,
  0.004  -- Default 0.4% commission
FROM trade_file tf
LEFT JOIN investors i ON i.investor_code = tf.investor_code
WHERE i.investor_code IS NULL
  AND tf.trade_date = p_trade_date
ON CONFLICT (investor_code) DO NOTHING;
```

### Option C: Show Unmatched Data Warning in Accounting Page

Add a warning banner showing how much data is unmatched, with a link to import missing investors.

---

## Recommended Approach: Option B + Option C

1. **Modify EOD Function** to auto-create placeholder investor records during processing
2. **Add Warning UI** in Accounting page when there's unmatched staging data
3. **Create Admin Tool** to review and update auto-created investor records

---

## Technical Implementation

### Step 1: Update process_staged_trades Function

Add auto-creation of missing investors at the start of processing:

```sql
-- Step 0: Create placeholder records for missing investors
INSERT INTO investors (investor_code, investor_name, brokerage_commission, status, created_at)
SELECT DISTINCT
  COALESCE(tf.investor_code, clt.investor_code),
  'Pending Update',
  0.004,
  'Auto-Created',
  NOW()
FROM (
  SELECT DISTINCT investor_code FROM trade_file WHERE trade_date = p_trade_date
  UNION
  SELECT DISTINCT investor_code FROM cash_ledger_txn WHERE txn_date = p_trade_date
) combined(investor_code)
LEFT JOIN investors i ON i.investor_code = combined.investor_code
WHERE i.investor_code IS NULL
ON CONFLICT (investor_code) DO NOTHING;
```

### Step 2: Add Unmatched Data Warning to Accounting Page

Create a query to check for unmatched staging data and display a warning:

```typescript
// Query to check unmatched trades
const { data: unmatchedStats } = useQuery({
  queryKey: ['unmatched-staging-data', selectedDateStr],
  queryFn: async () => {
    const { data } = await supabase.rpc('get_unmatched_staging_summary', {
      p_trade_date: selectedDateStr
    });
    return data;
  }
});
```

### Step 3: Create Missing Investors Report

Add admin tool to view and update auto-created investor records with proper details.

---

## Files to Modify

| File | Change |
|------|--------|
| SQL Migration | Update `process_staged_trades` to auto-create missing investors |
| SQL Migration | Add `get_unmatched_staging_summary` RPC function |
| `src/components/trade-history/AccountingTab.tsx` | Add unmatched data warning banner |
| `src/pages/InvestorsPage.tsx` | Add filter to show "Auto-Created" status investors |

---

## Expected Outcome

After implementation:
1. All 1,287 missing investors will be auto-created during EOD processing
2. Commission calculations will include all trades (full 4.47M instead of 4.22M)
3. Deposits/withdrawals will match (full 113.3M instead of 82.5M)
4. Accounting page totals will match source data exactly
5. Admins can review and update auto-created investor details

