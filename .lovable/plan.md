

## Comprehensive Fix: Process Staged Trades Duplicate Key Error

### Root Cause Analysis

The `process_staged_trades` function fails with:
```
duplicate key value violates unique constraint "eod_ledger_snapshots_eod_date_investor_code_key"
```

**The Problem**: The `tmp_investor_meta` temporary table creates duplicate investor_code rows due to the employee JOIN logic:

```sql
LEFT JOIN employees e ON LOWER(i.rm_id) = LOWER(e.employee_id)
   OR LOWER(i.rm_name) = LOWER(e.name)
```

When multiple employees share the same name (e.g., two "Kamal Hossain" with IDs 30345 and 30347), investors assigned to that RM get duplicated.

| Table | Expected Rows | Actual Rows | Duplicates |
|-------|---------------|-------------|------------|
| investors | 32,099 | 32,099 | 0 |
| tmp_investor_meta | 32,099 | 32,230 | 131 extra |

These duplicates cascade into the final INSERT, violating the unique constraint on `(eod_date, investor_code)`.

---

### Technical Solution

#### 1. Fix tmp_investor_meta to eliminate duplicates
Use `DISTINCT ON (investor_code)` to ensure one row per investor, prioritizing the employee_id match over the name match:

```sql
CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
SELECT DISTINCT ON (i.investor_code)
  i.investor_code,
  i.investor_name,
  i.brokerage_commission,
  i.interest_rate AS investor_interest_rate,
  i.account_type,
  e.employee_id AS rm_id,
  e.name AS rm_name,
  e.email AS rm_email,
  e.department
FROM investors i
LEFT JOIN employees e 
  ON LOWER(i.rm_id) = LOWER(e.employee_id)
  OR LOWER(i.rm_name) = LOWER(e.name)
ORDER BY i.investor_code, 
  -- Prioritize employee_id match over name match
  CASE WHEN LOWER(i.rm_id) = LOWER(e.employee_id) THEN 0 ELSE 1 END;
```

#### 2. Add EXCEPTION handler for graceful error reporting
Match `run_batch_eod` pattern to return structured error instead of crashing:

```sql
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
```

#### 3. Add defensive DISTINCT ON to final INSERT
Extra safeguard in case other joins also produce duplicates:

```sql
INSERT INTO eod_ledger_snapshots (...)
SELECT DISTINCT ON (bi.investor_code)
  p_trade_date,
  bi.investor_code,
  ...
FROM tmp_base_investors bi
...
ORDER BY bi.investor_code;
```

---

### Files to Modify

| File | Change |
|------|--------|
| Database Migration | Update `process_staged_trades` function with all 3 fixes |

---

### Migration SQL Summary

```sql
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  -- ... existing declarations ...
BEGIN
  -- ... existing DELETE and temp table logic ...

  -- FIXED: Use DISTINCT ON to prevent duplicate investor rows
  CREATE TEMP TABLE tmp_investor_meta ON COMMIT DROP AS
  SELECT DISTINCT ON (i.investor_code)
    i.investor_code,
    i.investor_name,
    i.brokerage_commission,
    i.interest_rate AS investor_interest_rate,
    i.account_type,
    e.employee_id AS rm_id,
    e.name AS rm_name,
    e.email AS rm_email,
    e.department
  FROM investors i
  LEFT JOIN employees e 
    ON LOWER(i.rm_id) = LOWER(e.employee_id)
    OR LOWER(i.rm_name) = LOWER(e.name)
  ORDER BY i.investor_code, 
    CASE WHEN LOWER(i.rm_id) = LOWER(e.employee_id) THEN 0 ELSE 1 END;

  -- ... rest of temp tables ...

  -- FIXED: Add DISTINCT ON to final INSERT as safeguard
  INSERT INTO eod_ledger_snapshots (...)
  SELECT DISTINCT ON (bi.investor_code)
    p_trade_date,
    bi.investor_code,
    ...
  FROM tmp_base_investors bi
  ...
  ORDER BY bi.investor_code;

  -- ... rest of aggregation and history insert ...

  RETURN v_result;

-- FIXED: Add exception handler
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;
```

---

### Post-Implementation Verification

1. Clear any partial Feb 1 EOD data using "Clear Selected" button
2. Re-run "Process Staged Trades" for Feb 1
3. Verify success message shows snapshot count
4. Check EOD Run History table updates correctly

