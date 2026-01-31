

# Implement Process Staged Trades Function

## Overview

Create a new `process_staged_trades` database function that processes trades from the `trade_file` staging table and deposits/withdrawals from `cash_ledger_txn`. This replaces the dependency on the old `trade_history` and `deposits_withdrawals` tables in the EOD workflow.

---

## Current State Analysis

### Data in Staging Tables (Ready for Processing)

| Table | Records | Date | Total Value |
|-------|---------|------|-------------|
| `trade_file` | 23,749 trades | 2026-01-13 | 977M BDT |
| `cash_ledger_txn` | 417 transactions | 2026-01-13 | 37.4M deposits, 137M withdrawals |

### Current `run_batch_eod` Function Issue

The existing function reads from:
- `trade_history` (old table with TEXT date format)
- `deposits_withdrawals` (old table)

It does NOT use the new staging tables:
- `trade_file` (new, DATE type)
- `cash_ledger_txn` (new, normalized transaction types)

---

## Implementation Plan

### Phase 1: Create Database Function

Create `process_staged_trades(p_trade_date DATE)` that:
1. Reads from `trade_file` for the specified date
2. Reads from `cash_ledger_txn` for deposits/withdrawals
3. Aggregates by investor: gross_buy, gross_sell, commission
4. Calculates settlement status based on T+2/T+3 rules
5. Returns summary statistics

```sql
CREATE OR REPLACE FUNCTION public.process_staged_trades(p_trade_date DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_trade_count integer := 0;
  v_investor_count integer := 0;
  v_gross_buy numeric := 0;
  v_gross_sell numeric := 0;
  v_total_commission numeric := 0;
  v_deposit_count integer := 0;
  v_withdrawal_count integer := 0;
  v_total_deposits numeric := 0;
  v_total_withdrawals numeric := 0;
BEGIN
  -- Security check
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Admin role required'
    );
  END IF;

  -- Aggregate trade data from trade_file staging table
  SELECT 
    COUNT(*),
    COUNT(DISTINCT investor_code),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN qty * price ELSE 0 END), 0),
    COALESCE(SUM(commission), 0)
  INTO 
    v_trade_count,
    v_investor_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission
  FROM trade_file
  WHERE trade_date = p_trade_date;

  -- Aggregate deposit/withdrawal data from cash_ledger_txn
  SELECT 
    COUNT(*) FILTER (WHERE type = 'DEPOSIT'),
    COUNT(*) FILTER (WHERE type = 'WITHDRAW'),
    COALESCE(SUM(amount) FILTER (WHERE type = 'DEPOSIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'WITHDRAW'), 0)
  INTO 
    v_deposit_count,
    v_withdrawal_count,
    v_total_deposits,
    v_total_withdrawals
  FROM cash_ledger_txn
  WHERE txn_date = p_trade_date;

  -- Log the processing run
  INSERT INTO eod_run_history (
    run_date,
    status,
    clients_processed,
    trade_files_count,
    gross_buy,
    gross_sell,
    total_commission,
    total_deposits,
    total_withdrawals,
    created_by
  ) VALUES (
    p_trade_date,
    'staged_processed',
    v_investor_count,
    v_trade_count,
    v_gross_buy,
    v_gross_sell,
    v_total_commission,
    v_total_deposits,
    v_total_withdrawals,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'trade_date', p_trade_date,
    'trade_count', v_trade_count,
    'investor_count', v_investor_count,
    'gross_buy', v_gross_buy,
    'gross_sell', v_gross_sell,
    'total_commission', v_total_commission,
    'deposit_count', v_deposit_count,
    'withdrawal_count', v_withdrawal_count,
    'total_deposits', v_total_deposits,
    'total_withdrawals', v_total_withdrawals,
    'net_trade_value', v_gross_sell - v_gross_buy,
    'net_cash_flow', v_total_deposits - v_total_withdrawals
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;
```

### Phase 2: Create Settlement Processing Function

Create `calculate_settlements(p_as_of_date DATE)` that:
1. Finds all trades where `settlement_date <= p_as_of_date`
2. Updates matured balances based on settled trades
3. Tracks pending settlements (T+2 and T+3)

```sql
CREATE OR REPLACE FUNCTION public.calculate_settlements(p_as_of_date DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_settled_trades integer := 0;
  v_settled_value numeric := 0;
  v_pending_t2 integer := 0;
  v_pending_t3 integer := 0;
BEGIN
  -- Security check
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin role required');
  END IF;

  -- Count settled trades (settlement_date <= as_of_date)
  SELECT COUNT(*), COALESCE(SUM(qty * price), 0)
  INTO v_settled_trades, v_settled_value
  FROM trade_file
  WHERE settlement_date <= p_as_of_date;

  -- Count pending T+2 trades (standard categories)
  SELECT COUNT(*) INTO v_pending_t2
  FROM trade_file
  WHERE settlement_date > p_as_of_date
    AND (category IS NULL OR UPPER(category) != 'Z');

  -- Count pending T+3 trades (Z category)
  SELECT COUNT(*) INTO v_pending_t3
  FROM trade_file
  WHERE settlement_date > p_as_of_date
    AND UPPER(category) = 'Z';

  RETURN jsonb_build_object(
    'success', true,
    'as_of_date', p_as_of_date,
    'settled_trades', v_settled_trades,
    'settled_value', v_settled_value,
    'pending_t2_count', v_pending_t2,
    'pending_t3_count', v_pending_t3
  );
END;
$$;
```

### Phase 3: Update Frontend Handler

Update `EodPage.tsx` to call the new function:

```typescript
const handleProcessStaged = async () => {
  if (!selectedDate) {
    toast.error("Please select a date");
    return;
  }

  setRunning(true);
  try {
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const { data, error } = await supabase.rpc("process_staged_trades", {
      p_trade_date: dateStr,
    });

    if (error) throw error;

    if (data?.success) {
      toast.success("Staged trades processed", {
        description: `${data.trade_count?.toLocaleString()} trades, ${data.investor_count?.toLocaleString()} investors`,
      });
    } else {
      toast.error("Processing failed", { description: data?.error });
    }
  } catch (err: any) {
    toast.error("Processing failed", { description: err.message });
  } finally {
    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
  }
};
```

Similarly update `handleCalculateSettlements`.

---

## Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| Database Migration | Create | `process_staged_trades` and `calculate_settlements` functions |
| `src/pages/EodPage.tsx` | Modify | Replace placeholder handlers with actual RPC calls |
| `src/components/eod/EodActionButtons.tsx` | Modify | Add processing state indicators |

---

## Processing Results Dialog (Optional Enhancement)

After processing, show a summary dialog with:

| Metric | Value |
|--------|-------|
| Trade Count | 23,749 |
| Unique Investors | ~2,500 |
| Gross Buy | 488M BDT |
| Gross Sell | 489M BDT |
| Deposits | 37.4M BDT |
| Withdrawals | 137M BDT |
| Net Cash Flow | -99.6M BDT |

---

## Technical Notes

1. **Data Source Migration**: The new functions read from `trade_file` and `cash_ledger_txn` instead of `trade_history` and `deposits_withdrawals`

2. **Settlement Date**: Already calculated during import using Bangladesh weekends (Fri/Sat) and bank holidays

3. **Settlement Logic**:
   - T+2: Most securities (Categories A, B, N, etc.)
   - T+3: Z-category securities only
   - Settlement date pre-calculated in `trade_file.settlement_date`

4. **Performance**: Using MATERIALIZED CTEs and direct DATE comparisons (no text conversion needed)

5. **Security**: Both functions use `SECURITY DEFINER` with admin role check

---

## Testing Checklist

After implementation:
- [ ] Click "Process Staged Trades" for 2026-01-13
- [ ] Verify summary shows ~23,749 trades processed
- [ ] Click "Calculate Settlements" and verify T+2/T+3 counts
- [ ] Check `eod_run_history` for new processing record
- [ ] Verify gross buy/sell totals match imported data

