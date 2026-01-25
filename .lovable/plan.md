
# Plan: Fix 1,000 Row Limit on Margin Dashboard

## Problem Identified
The dashboard is currently fetching only 1,000 rows out of **32,209 total rows** in the `margin_equity_snapshots` view. This causes significantly understated metrics:

| Metric | Currently Showing | Actual Full Data |
|--------|------------------|------------------|
| Total Margin Outstanding | ৳35.53 Cr | ৳712 Cr |
| Total Portfolio Value | ৳198.36 Cr | ৳5,908 Cr |
| High-Risk Clients | 28 | 1,334 |
| Safe Clients | partial | 4,100 |
| Total Interest Accrued | ৳1.86 L | ৳35.12 L |

## Root Cause
Supabase has a default 1,000 row limit per query. This is **not a plan limitation** - it's an API default behavior. Upgrading your Supabase plan won't change this.

## Recommended Solution: Server-Side Aggregation
Create an RPC function to calculate aggregates on the database server, returning only the summary data (not 32K rows).

### Benefits:
- No client-side data transfer of 32K+ rows
- Fast calculation on database server
- Single API call returns all KPIs
- Scalable as data grows

---

## Implementation Steps

### Step 1: Create RPC Function
Create a new database function `get_margin_dashboard_summary` that calculates all KPIs server-side:

```sql
CREATE OR REPLACE FUNCTION get_margin_dashboard_summary(p_eod_date date DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_eod_date date;
  v_result JSON;
BEGIN
  -- Use provided date or latest available
  IF p_eod_date IS NULL THEN
    SELECT MAX(eod_date) INTO v_eod_date FROM eod_ledger_snapshots;
  ELSE
    v_eod_date := p_eod_date;
  END IF;

  SELECT json_build_object(
    'eod_date', v_eod_date,
    'total_margin_outstanding', SUM(ABS(LEAST(ledger_closing_balance, 0))),
    'total_portfolio_value', SUM(total_portfolio_value),
    'total_equity', SUM(equity),
    'total_accrued_interest', SUM(accrued_interest),
    'high_risk_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 < 110
    ),
    'warning_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 >= 110 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 < 130
    ),
    'safe_count', COUNT(*) FILTER (
      WHERE ledger_closing_balance < 0 
      AND (equity / NULLIF(ABS(ledger_closing_balance), 0)) * 100 >= 130
    ),
    'total_margin_clients', COUNT(*) FILTER (WHERE ledger_closing_balance < 0)
  ) INTO v_result
  FROM margin_equity_snapshots
  WHERE eod_date = v_eod_date;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Step 2: Create Top Clients RPC Function
Separate function for the Top 10 clients by exposure (paginated):

```sql
CREATE OR REPLACE FUNCTION get_top_margin_clients(
  p_eod_date date DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  investor_code text,
  rm_name text,
  department_name text,
  exposure numeric,
  margin_ratio numeric,
  equity numeric,
  portfolio_value numeric
) AS $$
DECLARE
  v_eod_date date;
BEGIN
  IF p_eod_date IS NULL THEN
    SELECT MAX(eod_date) INTO v_eod_date FROM eod_ledger_snapshots;
  ELSE
    v_eod_date := p_eod_date;
  END IF;

  RETURN QUERY
  SELECT 
    mes.investor_code,
    mes.rm_name,
    mes.department_name,
    ABS(mes.ledger_closing_balance) as exposure,
    (mes.equity / NULLIF(ABS(mes.ledger_closing_balance), 0)) * 100 as margin_ratio,
    mes.equity,
    mes.total_portfolio_value as portfolio_value
  FROM margin_equity_snapshots mes
  WHERE mes.eod_date = v_eod_date
    AND mes.ledger_closing_balance < 0
  ORDER BY ABS(mes.ledger_closing_balance) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Step 3: Update DashboardTab.tsx
Modify the component to use RPC functions instead of fetching all rows:

```typescript
// Replace current query with RPC call
const { data: dashboardSummary, isLoading } = useQuery({
  queryKey: ['margin-dashboard-summary'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('get_margin_dashboard_summary');
    if (error) throw error;
    return data;
  }
});

const { data: topClients } = useQuery({
  queryKey: ['margin-top-clients'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('get_top_margin_clients', { p_limit: 10 });
    if (error) throw error;
    return data;
  }
});
```

### Step 4: Calculate Derived Metrics
In the component, calculate remaining metrics from the summary:

```typescript
const metrics = useMemo(() => {
  if (!dashboardSummary) return defaultMetrics;
  
  const { total_margin_outstanding, total_portfolio_value, ...rest } = dashboardSummary;
  
  return {
    ...rest,
    avgMarginRatio: total_portfolio_value > 0 
      ? (total_margin_outstanding / total_portfolio_value) * 100 
      : 0,
    overallUtilization: total_portfolio_value > 0 
      ? (total_margin_outstanding / total_portfolio_value) * 100 
      : 0,
    availableCapacity: Math.max(0, total_portfolio_value - total_margin_outstanding)
  };
}, [dashboardSummary]);
```

---

## Expected Results After Implementation

| Metric | Current (Wrong) | After Fix (Correct) |
|--------|-----------------|---------------------|
| Total Margin Outstanding | ৳35.53 Cr | ৳712 Cr |
| Total Portfolio Value | ৳198.36 Cr | ৳5,908 Cr |
| Overall Utilization | 17.9% | 12.1% |
| Average Margin Ratio | 18% | 12.1% |
| High-Risk Clients | 28 | 1,334 |
| Available Capacity | ৳162.83 Cr | ৳5,196 Cr |
| Total Interest Accrued | ৳1.86 L | ৳35.12 L |

---

## Summary

**No Supabase plan upgrade needed.** The 1,000 row limit is an API default, not a plan restriction.

The fix involves:
1. Creating 2 RPC functions for server-side aggregation
2. Updating the DashboardTab component to use these RPC functions
3. Result: Accurate metrics from all 32,209 rows without transferring data to client
