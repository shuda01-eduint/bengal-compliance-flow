

## Analysis: January 25 EOD Timeout Issue

### What's Happening

The EOD process is hitting an **HTTP gateway timeout** (~120 seconds) before the PostgreSQL query can complete. The database function has a 300-second timeout, but the Lovable Cloud HTTP layer has a stricter limit.

| Date | Duration | Status |
|------|----------|--------|
| Jan 18-24 | 42-60 sec | Success |
| Jan 25 | 125-145 sec | Timeout |

### Why January 25 Is Slower

1. **Larger Dataset**
   - 31,065 trades on Jan 25 (vs 29,423 on Jan 22)
   - 32,687 investors in the universe
   - Data volume is growing daily

2. **Cumulative Processing**
   - Delta calculations scan trade_history twice (today vs yesterday)
   - Opening balance lookups across 32K+ investors
   - Holding snapshots insertion for all positions

3. **HTTP Gateway Limit**
   - Supabase HTTP proxy has ~120s timeout
   - Cannot be increased from function settings
   - The 300s statement_timeout only prevents DB-level runaway queries

### Solution Options

**Option A: Optimize the Current Function** (Recommended)
- Add early exit conditions
- Reduce redundant subqueries
- Use temporary tables for intermediate results
- Batch holdings snapshot insertion

**Option B: Split Into Smaller Operations**
- Create separate functions for each phase:
  1. Calculate ledger balances (fast)
  2. Snapshot holdings (separate call)
  3. Record run history
- Call sequentially from frontend

**Option C: Use Background Processing**
- Create an edge function for long-running EOD
- Use database pg_cron for scheduling
- More complex but handles any dataset size

### Recommended Approach

I recommend **Option A** - optimizing the function to complete within 90 seconds by:

1. **Pre-computing delta values** in a single pass instead of subqueries
2. **Removing redundant universe recalculation** 
3. **Batching holdings inserts** in chunks of 5,000
4. **Adding query planner hints** to use indexes efficiently

### Technical Implementation

Create a migration with an optimized version of `run_batch_eod`:

```text
+------------------+     +-------------------+     +------------------+
| 1. Single CTE    | --> | 2. Batch Process  | --> | 3. Atomic Insert |
| Universe + Deltas|     | Holdings (5K/batch)|    | Final Snapshots  |
+------------------+     +-------------------+     +------------------+
        |                         |                        |
    ~15 seconds              ~30 seconds              ~20 seconds
                                                    Total: ~65 seconds
```

Key optimizations:
- Combine universe and delta calculation into single scan
- Use `WITH` clauses for materialized intermediate results
- Add `/*+ IndexScan */` hints for trade_history queries
- Limit holdings snapshot to investors with actual positions

### After Fix

Once deployed:
1. January 25 EOD should complete in ~60-90 seconds
2. Future dates will also benefit from optimization
3. System can scale to larger datasets

