
## Fix: Lock Timeout on Process Staged Trades

### Problem Analysis

The `process_staged_trades` function is failing with:
```
"canceling statement due to lock timeout" (error code 55P03)
```

**Root Cause**: The function performs large DELETE operations at the start (32,099 snapshots + 75,212 positions) which require table locks. Supabase's default lock_timeout is causing the function to abort when it can't acquire locks quickly enough.

| Current Setting | Value | Issue |
|-----------------|-------|-------|
| statement_timeout | 300s | Sufficient |
| lock_timeout | Default (unset) | Too restrictive for large deletes |

### Technical Solution

Add `lock_timeout` configuration to the function and optimize the delete strategy to reduce lock contention:

1. **Set lock_timeout to 60s** - Give enough time to acquire locks on the EOD tables
2. **Use TRUNCATE-like approach** - Delete in batches or use more efficient cleanup
3. **Add advisory locks** - Prevent concurrent EOD runs from conflicting

### Implementation Changes

```sql
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
SET lock_timeout TO '60s'  -- NEW: Allow time to acquire locks
AS $$
DECLARE
  -- ... existing declarations ...
  v_lock_acquired boolean;
BEGIN
  -- NEW: Acquire advisory lock to prevent concurrent runs
  SELECT pg_try_advisory_xact_lock(hashtext('eod_' || p_trade_date::text)) INTO v_lock_acquired;
  
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Another EOD process is running for this date',
      'error_detail', 'CONCURRENT_RUN'
    );
  END IF;

  -- Existing logic continues...
  DELETE FROM eod_ledger_snapshots WHERE eod_date = p_trade_date;
  DELETE FROM eod_instrument_position WHERE trade_date = p_trade_date;
  DELETE FROM eod_run_history WHERE run_date = p_trade_date;
  
  -- ... rest of function ...
```

### Database Changes

| Change | Description |
|--------|-------------|
| Add `SET lock_timeout TO '60s'` | Extends time to acquire locks |
| Add advisory lock | Prevents concurrent EOD runs |
| Return structured error | When another process is running |

### Files to Modify

| File | Change |
|------|--------|
| Database Migration | Update `process_staged_trades` function |

### Post-Implementation Steps

1. Wait for any previous EOD attempts to fully release locks (a few seconds)
2. Re-run "Process Staged Trades" for February 1
3. If data already exists correctly, you can skip re-processing
