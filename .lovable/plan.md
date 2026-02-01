

## Fix Accounting Page: Read Directly from EOD Snapshots

### Problem Summary

The Accounting page is failing with the error **"column reference 'investor_code' is ambiguous"** because the `get_accounting_data_v3` RPC function joins multiple tables (like `eod_ledger_snapshots`, `balances_raw`, `trade_file`, `trade_history`, etc.) and some queries don't properly qualify which table's `investor_code` to use.

However, the real solution is simpler: **bypass the RPC entirely** and query `eod_ledger_snapshots` directly. The EOD process already calculates and stores all the accounting data, so there's no need to recalculate it.

---

### Solution Overview

Replace the complex RPC-based approach with a direct Supabase query to `eod_ledger_snapshots` for the selected EOD date.

| Current Approach | New Approach |
|-----------------|--------------|
| Complex RPC with 8+ CTEs | Single table query |
| Joins cause ambiguous column errors | No joins needed |
| Recalculates everything each time | Reads pre-calculated data |
| Can timeout on large datasets | Fast indexed lookup |
| Uses legacy tables as fallback | Uses authoritative EOD data |

---

### What the User Will See

1. **Single Date Picker**: Instead of From/To date range, a single "EOD Date" selector
2. **EOD Status Check**: If no snapshot exists for selected date, show a clear message with link to EOD page
3. **Faster Loading**: Direct table query is much faster than complex RPC
4. **Consistent Data**: Always matches EOD results exactly

---

### Implementation Details

#### File: `src/components/trade-history/AccountingTab.tsx`

**1. Simplify State Management**

Remove dual date pickers and use a single selected date:

```typescript
// Before
const [fromDate, setFromDate] = useState<Date>(new Date());
const [toDate, setToDate] = useState<Date>(new Date());

// After
const [selectedDate, setSelectedDate] = useState<Date>(new Date());
```

**2. Replace RPC Query with Direct Table Query**

```typescript
const { data: accountingResult, isLoading, isError, error } = useQuery({
  queryKey: ['accounting-eod-snapshot', selectedDateStr, debouncedSearch, accountTypeFilter, activityFilter],
  queryFn: async () => {
    // Build query to eod_ledger_snapshots
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
    if (debouncedSearch) {
      query = query.or(`investor_code.ilike.%${debouncedSearch}%,investor_name.ilike.%${debouncedSearch}%,rm_name.ilike.%${debouncedSearch}%`);
    }

    // Apply account type filter
    if (accountTypeFilter && accountTypeFilter !== 'all') {
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
    if (error) throw error;
    return data || [];
  },
  staleTime: 5 * 60 * 1000,
});
```

**3. Add EOD Availability Check**

Check if EOD has been run for the selected date:

```typescript
const { data: eodStatus } = useQuery({
  queryKey: ['eod-run-status', selectedDateStr],
  queryFn: async () => {
    const { data } = await supabase
      .from('eod_run_history')
      .select('id, run_date, clients_captured, status')
      .eq('run_date', selectedDateStr)
      .eq('status', 'completed')
      .maybeSingle();
    return data;
  },
});

const hasEodData = !!eodStatus;
```

**4. Update Field Mapping**

Map snapshot columns to UI interface (the snapshot table columns align directly):

| UI Column | Snapshot Column |
|-----------|-----------------|
| Opening Bal | `opening_balance` |
| Deposits | `total_deposits` |
| Withdrawals | `total_withdrawals` |
| Gross Buy | `gross_buy` |
| Gross Sell | `gross_sell` |
| Brokerage | `total_commission` |
| Closing Balance | `closing_balance` |

```typescript
const processedRow: AccountingRow = {
  investor_code: row.investor_code || '',
  investor_name: row.investor_name || '',
  account_type: row.account_type || '',
  rm_name: row.rm_name || '',
  department: row.department || '',
  ledger_balance: Number(row.opening_balance) || 0,
  total_deposits: Number(row.total_deposits) || 0,
  total_withdrawals: Number(row.total_withdrawals) || 0,
  gross_buy: Number(row.gross_buy) || 0,
  gross_sell: Number(row.gross_sell) || 0,
  brokerage_amount: Number(row.total_commission) || 0,
  final_balance: Number(row.closing_balance) || 0,
  // ... other fields
};
```

**5. Simplify Date UI**

Replace From/To date pickers with single EOD Date selector:

```tsx
<div className="flex items-center gap-2">
  <Label className="text-sm">EOD Date</Label>
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" className="w-[200px] justify-start">
        <CalendarIcon className="mr-2 h-4 w-4" />
        {format(selectedDate, "PPP")}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={(date) => date && setSelectedDate(normalizeToLocalDate(date))}
        className="p-3 pointer-events-auto"
      />
    </PopoverContent>
  </Popover>
</div>
```

**6. Add "No EOD Data" State**

When no EOD snapshot exists for the selected date:

```tsx
{!hasEodData && !isLoading && (
  <Alert className="mb-4">
    <AlertTriangle className="h-4 w-4" />
    <AlertDescription className="flex items-center justify-between">
      <span>No EOD data for {format(selectedDate, "PPP")}. Run EOD processing first.</span>
      <Button variant="link" size="sm" asChild>
        <a href="/eod">Go to EOD Page</a>
      </Button>
    </AlertDescription>
  </Alert>
)}
```

**7. Initialize with Latest EOD Date**

Fetch the most recent EOD-processed date on mount:

```typescript
useEffect(() => {
  const fetchLatestEodDate = async () => {
    const { data } = await supabase
      .from('eod_run_history')
      .select('run_date')
      .eq('status', 'completed')
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (data?.run_date) {
      setSelectedDate(parseISO(data.run_date));
    }
  };
  fetchLatestEodDate();
}, []);
```

---

### Code Cleanup

The following can be removed as they're no longer needed:

1. `fromDate` and `toDate` state variables
2. `openingDateStr` calculation (snapshots already have opening_balance)
3. `dateRangeDays` and `isLargeRange` calculations
4. `dateRangeWarning` state and display
5. `handleFromDateChange` and `handleSetSingleDay` handlers
6. Import/usage of `rpcWithRetry` (no longer needed for main query)
7. The `trade_history` query for latest date (use `eod_run_history` instead)

---

### Benefits

1. **Fixes the Bug**: No more "ambiguous column" errors since we're querying a single table
2. **Faster**: Direct indexed query vs complex RPC with 8+ CTEs
3. **Simpler Code**: ~100 fewer lines of date handling and RPC complexity
4. **Consistent**: Always shows exactly what EOD calculated
5. **Reliable**: No timeouts since we're not joining/aggregating

---

### What Stays the Same

- Search filtering (now applied at query level)
- Account type filter
- Activity filter (with_trades, with_activity, etc.)
- Column visibility and reordering
- Custom fields and formulas
- Export functionality
- Summary cards (computed from query results)
- Client-side sorting

