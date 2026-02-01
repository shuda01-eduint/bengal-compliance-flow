

## Plan: Fix `process_staged_trades` to Record in `eod_run_history`

### Problem Analysis

After thorough investigation, I found that:

1. **Feb 1 EOD processing completed successfully** - 32,099 snapshots were created with correct commission (5.55M BDT)
2. **The baseline priority fix is working** - Opening balances now correctly use the Jan 31 baseline from `eod_investor_balance`
3. **However, `process_staged_trades` does not record in `eod_run_history`** - This creates confusion because the EOD Log Table shows no record for Feb 1

The user likely saw that:
- `process_staged_trades` showed success toast
- But the EOD Run History table showed no Feb 1 record
- This appeared as an "error" or missing result

### Root Cause

The `process_staged_trades` function was designed to only return results in its JSONB response without persisting an audit record. The `run_batch_eod` function does persist to `eod_run_history`.

### Solution

Add an INSERT statement to `process_staged_trades` to record the run in `eod_run_history`, matching the pattern used by `run_batch_eod`.

---

### Technical Implementation

**Database Migration** - Add history recording to `process_staged_trades`:

```sql
-- After line 303 (before RETURN), add:
INSERT INTO eod_run_history (
  run_date, 
  run_at, 
  run_by, 
  run_by_email, 
  clients_captured, 
  total_ledger_balance,
  trade_files_count, 
  deposit_records_count, 
  gross_buy, 
  gross_sell,
  total_commission, 
  total_deposits, 
  total_withdrawals, 
  status,
  notes
)
VALUES (
  p_trade_date, 
  now(), 
  auth.uid(), 
  (SELECT email FROM auth.users WHERE id = auth.uid()),
  v_snapshots_created,
  (SELECT COALESCE(SUM(closing_balance), 0) FROM eod_ledger_snapshots WHERE eod_date = p_trade_date),
  v_trade_count,
  v_deposit_count + v_withdrawal_count,
  v_gross_buy,
  v_gross_sell,
  v_total_commission,
  v_total_deposits,
  v_total_withdrawals,
  'completed',
  'Processed via staged trades'
);
```

### Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Audit trail | No history record | Records in `eod_run_history` |
| EOD Log Table | Shows blank for Feb 1 | Shows complete run details |
| Consistency | Different behavior from `run_batch_eod` | Matches `run_batch_eod` pattern |

---

### Files to Modify

| File | Change |
|------|--------|
| New SQL Migration | Add INSERT INTO `eod_run_history` in `process_staged_trades` function |

---

### Post-Implementation Steps

1. Deploy the migration
2. Manually insert a history record for the Feb 1 run that already completed:
```sql
INSERT INTO eod_run_history (
  run_date, run_at, clients_captured, total_ledger_balance,
  trade_files_count, gross_buy, gross_sell, total_commission,
  total_deposits, total_withdrawals, status, notes
)
SELECT 
  '2026-02-01',
  '2026-02-01 20:07:27+00',
  COUNT(*),
  SUM(closing_balance),
  (SELECT COUNT(*) FROM trade_file WHERE trade_date = '2026-02-01'),
  SUM(gross_buy),
  SUM(gross_sell),
  SUM(total_commission),
  SUM(total_deposits),
  SUM(total_withdrawals),
  'completed',
  'Backfilled from existing snapshots'
FROM eod_ledger_snapshots
WHERE eod_date = '2026-02-01';
```

3. Verify Feb 1 now appears in the EOD Log Table

