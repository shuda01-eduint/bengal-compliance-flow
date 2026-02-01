

## Plan: Prioritize `eod_investor_balance` Baseline in EOD Functions

### Problem Summary

The current EOD functions (`run_batch_eod` and `process_staged_trades`) use the **previous day's closing balance from `eod_ledger_snapshots`** as the opening balance for the next day. However, when the snapshot chain is corrupted (as we found with investors 9000, 20337, 21878, 13839, etc.), this propagates errors forward.

The `eod_investor_balance` table contains the **official imported baseline** (closing_ledger_balance) for a given date. This should be the authoritative source when available.

### Current Logic (Problematic)

```text
Opening Balance = eod_ledger_snapshots.closing_balance (previous day)
                  OR 0 if no snapshot exists
```

### Proposed Logic (Fixed)

```text
Opening Balance = eod_investor_balance.closing_ledger_balance (same date as previous day)
                  OR eod_ledger_snapshots.closing_balance (previous day)
                  OR investors.ledger_balance (original baseline)
                  OR 0 if nothing exists
```

This creates a priority chain:
1. **First**: Use official baseline from `eod_investor_balance` if one exists for the previous day
2. **Second**: Fall back to the snapshot chain if no baseline exists
3. **Third**: Use the investors table baseline
4. **Fourth**: Default to 0 for new accounts

---

### Technical Implementation

**Migration SQL** - Update both EOD functions:

#### 1. Update `run_batch_eod` Function

Modify the `prior_eod` CTE to prioritize `eod_investor_balance`:

```sql
prior_eod AS MATERIALIZED (
  SELECT 
    bi.investor_code,
    COALESCE(
      -- Priority 1: Official baseline from eod_investor_balance (previous day)
      eib.closing_ledger_balance,
      -- Priority 2: Prior snapshot chain
      prev_snap.closing_balance,
      -- Priority 3: Investors table baseline  
      i.ledger_balance,
      -- Priority 4: Default
      0
    ) AS closing_balance,
    COALESCE(prev_snap.cumulative_interest, 0) AS cumulative_interest
  FROM base_investors bi
  LEFT JOIN investors i ON bi.investor_code = i.investor_code
  LEFT JOIN eod_investor_balance eib 
    ON bi.investor_code = eib.investor_code 
    AND eib.trade_date = p_eod_date - INTERVAL '1 day'
  LEFT JOIN LATERAL (
    SELECT closing_balance, cumulative_interest
    FROM eod_ledger_snapshots
    WHERE investor_code = bi.investor_code 
      AND eod_date < p_eod_date
    ORDER BY eod_date DESC
    LIMIT 1
  ) prev_snap ON TRUE
)
```

#### 2. Update `process_staged_trades` Function

Same modification to `tmp_prior_eod` temp table:

```sql
CREATE TEMP TABLE tmp_prior_eod ON COMMIT DROP AS
SELECT 
  bi.investor_code,
  COALESCE(
    eib.closing_ledger_balance,
    prev_snap.closing_balance,
    i.ledger_balance,
    0
  ) AS closing_balance,
  COALESCE(prev_snap.cumulative_interest, 0) AS cumulative_interest
FROM tmp_base_investors bi
LEFT JOIN investors i ON bi.investor_code = i.investor_code
LEFT JOIN eod_investor_balance eib 
  ON bi.investor_code = eib.investor_code 
  AND eib.trade_date = p_trade_date - INTERVAL '1 day'
LEFT JOIN LATERAL (
  SELECT closing_balance, cumulative_interest
  FROM eod_ledger_snapshots
  WHERE investor_code = bi.investor_code 
    AND eod_date < p_trade_date
  ORDER BY eod_date DESC
  LIMIT 1
) prev_snap ON TRUE;
```

---

### Key Changes Summary

| Aspect | Current | After Fix |
|--------|---------|-----------|
| Opening balance source | Snapshot chain only | Baseline first, then snapshot chain |
| Corruption recovery | Propagates errors | Self-corrects from baseline |
| Fallback chain | Snapshot -> 0 | Baseline -> Snapshot -> investors.ledger_balance -> 0 |

---

### Testing After Implementation

1. **Clear Feb 1 snapshots**: 
   ```sql
   DELETE FROM eod_ledger_snapshots WHERE eod_date = '2026-02-01';
   ```

2. **Re-run EOD for Feb 1** using the EOD page

3. **Verify** the same 10 investors from the statement - they should now match because the function will use the Jan 31 baseline from `eod_investor_balance`

---

### Files to Modify

| File | Change |
|------|--------|
| New SQL Migration | Update `run_batch_eod` and `process_staged_trades` functions |

### No Frontend Changes Required

The EOD page and UI remain unchanged - only the database function logic is being fixed.

