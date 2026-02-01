

## Fix Accounting Page Not Showing Feb 1 Data

### Problem Summary
When viewing Feb 1, 2026 on the Accounting page, the data grid shows zero rows even though:
- EOD processing for Feb 1 completed successfully (32,099 snapshots created)
- 34,665 trades exist in `trade_file` for Feb 1
- 368 deposit/withdrawal transactions exist in `cash_ledger_txn` for Feb 1

### Root Cause Analysis
The `get_accounting_data_v3` RPC function queries from the **wrong source tables**:

| What Function Uses | What Has Feb 1 Data |
|--------------------|---------------------|
| `trade_history` (0 rows for Feb 1) | `trade_file` (34,665 rows) |
| `deposits_withdrawals` (0 rows for Feb 1) | `cash_ledger_txn` (368 rows) |

The function also applies a filter `_has_activity_filter = 'with_trades'` which returns 0 rows when no trades are found.

Additionally, the function uses `balances_raw` for opening balances with `as_of_date = _opening_date`, but `balances_raw` only has a snapshot for Jan 31 - it should instead use `eod_ledger_snapshots` which has data for all processed dates.

---

## Solution: Update `get_accounting_data_v3` to use correct source tables

### Changes Required

**Database Migration - Update `get_accounting_data_v3` function:**

1. **Replace `trade_history` with `trade_file`** in the `period_trades` CTE:
   - Column mappings: `client_code` becomes `investor_code`, `value` becomes `qty * price`
   - Use `trade_date` (DATE type) directly instead of YYYYMMDD string comparisons

2. **Replace `deposits_withdrawals` with `cash_ledger_txn`** in the `period_tx` CTE:
   - Column mappings: `transaction_type` becomes `type`, `transaction_date` becomes `txn_date`

3. **Use `eod_ledger_snapshots` for opening balance** (if available for the date):
   - Fall back to `balances_raw` only for historical dates before EOD processing started

4. **Add fallback logic** to also check `trade_history` for backward compatibility with older date ranges

### Updated SQL Logic (Simplified)

```sql
-- Opening balance from eod_ledger_snapshots (preferred) or balances_raw (fallback)
opening_balances AS (
  SELECT investor_code, closing_balance AS opening_balance
  FROM eod_ledger_snapshots
  WHERE eod_date = _opening_date
  UNION ALL
  SELECT investor_code, ledger_balance
  FROM balances_raw
  WHERE as_of_date = _opening_date
    AND investor_code NOT IN (SELECT investor_code FROM eod_ledger_snapshots WHERE eod_date = _opening_date)
),

-- Deposits/Withdrawals from cash_ledger_txn (preferred) or deposits_withdrawals (fallback)
period_tx AS (
  SELECT investor_code,
    SUM(CASE WHEN UPPER(type) = 'DEPOSIT' THEN amount ELSE 0 END) AS deposits,
    SUM(CASE WHEN UPPER(type) IN ('WITHDRAW','WITHDRAWAL') THEN amount ELSE 0 END) AS withdrawals
  FROM cash_ledger_txn
  WHERE txn_date > _opening_date AND txn_date <= _tx_date
  UNION ALL
  -- fallback to deposits_withdrawals for older data
  ...
),

-- Trades from trade_file (preferred) or trade_history (fallback)
period_trades AS (
  SELECT investor_code,
    SUM(CASE WHEN UPPER(side) IN ('B','BUY') THEN qty * price ELSE 0 END) AS gross_buy,
    SUM(CASE WHEN UPPER(side) IN ('S','SELL') THEN qty * price ELSE 0 END) AS gross_sell
  FROM trade_file
  WHERE trade_date > _opening_date AND trade_date <= _tx_date
  UNION ALL
  -- fallback to trade_history for older data
  ...
)
```

---

## Alternative Solution: Use `eod_ledger_snapshots` Directly

Since EOD processing already calculates all the values and stores them in `eod_ledger_snapshots`, the accounting page could query that table directly for the selected date:

```sql
SELECT 
  investor_code, investor_name, account_type, rm_name, department,
  opening_balance, total_deposits, total_withdrawals,
  gross_buy, gross_sell, total_commission AS brokerage,
  closing_balance
FROM eod_ledger_snapshots
WHERE eod_date = _tx_date
```

This would be:
- Much faster (no joins/aggregations needed)
- Always consistent with EOD results
- Simpler to maintain

**Trade-off:** Would only show data for dates that have EOD snapshots (no ad-hoc date ranges).

---

## Implementation Steps

1. **Create database migration** to update `get_accounting_data_v3`:
   - Add `trade_file` as primary source for trades
   - Add `cash_ledger_txn` as primary source for deposits/withdrawals
   - Use `eod_ledger_snapshots` for opening balances
   - Keep fallback to legacy tables for backward compatibility

2. **Test with Feb 1 date** to verify data appears correctly

3. **Validate commission values** appear in the Brokerage column

---

## Technical Details

### Current Function Issues
- Uses `trade_history.client_code` - should use `trade_file.investor_code`
- Uses `trade_history.value` - should use `trade_file.qty * trade_file.price`
- Uses `deposits_withdrawals.transaction_date` - should use `cash_ledger_txn.txn_date`
- Uses `deposits_withdrawals.transaction_type` (Deposit/Withdrawal) - should use `cash_ledger_txn.type` (DEPOSIT/WITHDRAW)
- String date comparison `YYYYMMDD` format - `trade_file` uses native DATE type

### Column Mapping Reference

| Legacy Table | New Table | Legacy Column | New Column |
|-------------|-----------|---------------|------------|
| trade_history | trade_file | client_code | investor_code |
| trade_history | trade_file | value | qty * price |
| trade_history | trade_file | trade_date (text YYYYMMDD) | trade_date (DATE) |
| trade_history | trade_file | brokerage_commission | commission |
| deposits_withdrawals | cash_ledger_txn | transaction_date | txn_date |
| deposits_withdrawals | cash_ledger_txn | transaction_type | type |
| balances_raw | eod_ledger_snapshots | as_of_date | eod_date |
| balances_raw | eod_ledger_snapshots | ledger_balance | closing_balance (for opening of next day) |

