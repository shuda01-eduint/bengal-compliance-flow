

## Plan: Fix Accounting Summary Cards to Show Correct EOD Date Totals

### Problem

The Commission view summary cards show incorrect totals because:
1. Data is fetched with a **LIMIT 1000** (line 364) but Feb 2 has 1,884 clients with trades
2. Summary is calculated from this limited dataset, not the complete day data
3. Expected: ৳4,219,971 Commission, ৳1,326,315,061 Turnover, 1,884 Clients
4. Current: ৳512,647 Commission, ৳198,195,380 Turnover, 65 Clients

---

### Solution

Create a separate query that fetches **aggregate totals only** for the selected EOD date without the 1000 row limit. The table can continue to paginate, but summary cards will show complete data.

---

### Changes

**File: `src/components/trade-history/AccountingTab.tsx`**

1. **Add new query for summary aggregates** (around line 315):
   - Create a new `useQuery` that fetches aggregate totals directly from `eod_ledger_snapshots`
   - Query: `SELECT SUM(total_commission), SUM(gross_buy), SUM(gross_sell), COUNT(*) ...`
   - No LIMIT, so it covers all clients for the selected date

2. **Update summary useMemo** (around line 474):
   - Use the new aggregate query results for the summary cards instead of calculating from limited `accountingData`
   - Fallback to calculating from `accountingData` if aggregate query fails

3. **Summary cards will use aggregate data**:
   - Total Commission: From aggregate SUM
   - Total Turnover: From aggregate SUM(gross_buy + gross_sell) 
   - Clients with Trades: From aggregate COUNT where gross_buy > 0 OR gross_sell > 0
   - Departments: From aggregate COUNT(DISTINCT department)

---

### Technical Details

**New Query Structure:**
```typescript
const { data: summaryAggregates } = useQuery({
  queryKey: ['accounting-summary-aggregates', selectedDateStr],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('eod_ledger_snapshots')
      .select('total_commission, gross_buy, gross_sell, department')
      .eq('eod_date', selectedDateStr);
    
    if (error) throw error;
    
    // Calculate aggregates
    let totalCommission = 0;
    let totalBuy = 0;
    let totalSell = 0;
    let clientsWithTrades = 0;
    const departments = new Set<string>();
    
    (data || []).forEach(row => {
      totalCommission += Number(row.total_commission) || 0;
      totalBuy += Number(row.gross_buy) || 0;
      totalSell += Number(row.gross_sell) || 0;
      if ((row.gross_buy || 0) > 0 || (row.gross_sell || 0) > 0) {
        clientsWithTrades++;
      }
      if (row.department) departments.add(row.department);
    });
    
    return {
      totalCommission,
      totalTurnover: totalBuy + totalSell,
      clientsWithTrades,
      uniqueDepartments: departments.size
    };
  },
  enabled: hasEodData,
});
```

**Updated Summary Object:**
```typescript
const summary = useMemo(() => {
  // Use aggregate data for cards (complete day totals)
  return {
    totalCommission: summaryAggregates?.totalCommission ?? 0,
    totalTradeValue: summaryAggregates?.totalTurnover ?? 0,
    clientsWithTrades: summaryAggregates?.clientsWithTrades ?? 0,
    uniqueDepartments: summaryAggregates?.uniqueDepartments ?? 0,
    // Keep table-specific calculations from accountingData
    totalAccounts: accountingData.length,
    ...
  };
}, [summaryAggregates, accountingData]);
```

---

### Expected Result

After implementation:
- **Total Commission**: ৳4,219,971 (from complete EOD snapshot)
- **Total Turnover**: ৳1,326,315,061 (from complete EOD snapshot)  
- **Clients with Trades**: 1,884 (from complete EOD snapshot)
- **Departments**: Correct count from all data

The table will still show paginated/limited results, but summary cards will reflect the full day's activity.

