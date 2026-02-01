# Accounting Page - EOD Snapshot Implementation

## Status: ✅ COMPLETED

The Accounting page has been refactored to read directly from `eod_ledger_snapshots` instead of using the complex `get_accounting_data_v3` RPC that was causing "column reference 'investor_code' is ambiguous" errors.

### What Changed

1. **Single Date Selector**: Replaced From/To date range with a single "EOD Date" picker
2. **Direct Table Query**: Queries `eod_ledger_snapshots` directly instead of complex RPC
3. **EOD Status Check**: Shows warning if no EOD data exists for selected date
4. **Auto-Initialize**: Loads the most recent EOD-processed date on mount
5. **Simplified Code**: Removed ~200 lines of date handling and RPC complexity

### Benefits
- ✅ No more "ambiguous column" errors
- ✅ Faster loading (direct indexed query)
- ✅ Always consistent with EOD results
- ✅ Simpler, more maintainable code
