

## Simplify Accounting Page to Read from EOD Snapshots

### Problem
The Accounting page uses a complex `get_accounting_data_v3` RPC that recalculates data from multiple source tables (`trade_file`, `cash_ledger_txn`, `balances_raw`). This is redundant because the EOD process already calculates and stores all this data in `eod_ledger_snapshots`.

### Solution
Replace the RPC-based approach with a direct query to `eod_ledger_snapshots` when EOD data exists for the selected date.

---

## Benefits

| Current Approach | New Approach |
|-----------------|--------------|
| Complex RPC with 5+ CTEs | Simple table query |
| Recalculates everything | Reads pre-calculated data |
| Can timeout on large datasets | Fast indexed lookup |
| Requires maintaining RPC logic | Automatically uses EOD results |
| May have calculation discrepancies | Always consistent with EOD |

---

## Implementation Changes

### File: `src/components/trade-history/AccountingTab.tsx`

**1. Simplify Date Handling**
- The Accounting page should work with a single date (the EOD date) instead of date ranges
- Remove the complex "opening date" calculation - EOD snapshots already have opening_balance

**2. Replace RPC Query with Direct Table Query**
```typescript
// Current: Complex RPC with multiple fallbacks
const { data } = await rpcWithRetry('get_accounting_data_v3', { ... });

// New: Simple direct query to eod_ledger_snapshots
const { data, error } = await supabase
  .from('eod_ledger_snapshots')
  .select('*')
  .eq('eod_date', selectedDateStr)
  .ilike('investor_code', `%${searchTerm}%`);
```

**3. Update Field Mappings**
The snapshot table columns map directly to the UI:

| UI Column | Snapshot Column |
|-----------|-----------------|
| Opening Bal | `opening_balance` |
| Deposits | `total_deposits` |
| Withdrawals | `total_withdrawals` |
| Gross Buy | `gross_buy` |
| Gross Sell | `gross_sell` |
| Brokerage | `total_commission` |
| Closing Balance | `closing_balance` |

**4. Add Fallback for Non-EOD Dates**
- Check if EOD snapshot exists for selected date
- If no snapshot exists, show a message: "No EOD data for this date. Run EOD processing first."
- This prevents confusion about why data is missing

**5. Handle Filtering**
- Account type filter: Use `.eq('account_type', filter)` 
- Activity filter: Use `.or('gross_buy.gt.0,gross_sell.gt.0,total_deposits.gt.0,total_withdrawals.gt.0')`
- Search: Use `.or(investor_code.ilike.%search%,investor_name.ilike.%search%)`

---

## Query Structure

```typescript
const fetchAccountingData = async () => {
  let query = supabase
    .from('eod_ledger_snapshots')
    .select(`
      investor_code,
      investor_name,
      account_type,
      rm_name,
      department,
      opening_balance,
      total_deposits,
      total_withdrawals,
      gross_buy,
      gross_sell,
      total_commission,
      closing_balance
    `)
    .eq('eod_date', selectedDateStr);

  // Apply search filter
  if (searchTerm) {
    query = query.or(`investor_code.ilike.%${searchTerm}%,investor_name.ilike.%${searchTerm}%`);
  }

  // Apply account type filter
  if (accountTypeFilter !== 'all') {
    query = query.eq('account_type', accountTypeFilter);
  }

  // Apply activity filter
  if (activityFilter === 'with_trades') {
    query = query.or('gross_buy.gt.0,gross_sell.gt.0');
  } else if (activityFilter === 'with_activity') {
    query = query.or('gross_buy.gt.0,gross_sell.gt.0,total_deposits.gt.0,total_withdrawals.gt.0');
  }

  // Order and limit
  query = query.order('investor_code').limit(1000);

  const { data, error } = await query;
  return data;
};
```

---

## Summary Cards Update

Update summary computation to use snapshot aggregates:

```typescript
const summary = useMemo(() => ({
  totalAccounts: data?.length || 0,
  totalBuy: data?.reduce((sum, r) => sum + (r.gross_buy || 0), 0) || 0,
  totalSell: data?.reduce((sum, r) => sum + (r.gross_sell || 0), 0) || 0,
  totalCommission: data?.reduce((sum, r) => sum + (r.total_commission || 0), 0) || 0,
  // ... other metrics
}), [data]);
```

---

## UI Changes

**1. Simplify Date Picker**
- Change from "From/To" date range to single "EOD Date" picker
- Show available EOD dates or latest processed date

**2. Add EOD Status Indicator**
- Show if EOD has been run for selected date
- Quick link to EOD page if not processed

**3. Remove Unnecessary Complexity**
- Remove the "opening date" logic (snapshots already have opening_balance)
- Remove date range warnings (single date = no timeout risk)

---

## Migration Notes

- The existing RPC `get_accounting_data_v3` can be deprecated but kept for backward compatibility
- The simpler approach is faster, more reliable, and always matches EOD results
- Date ranges are no longer supported (trade-off: can only view EOD-processed dates)

