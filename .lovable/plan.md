
# Plan: Populate Holding Snapshots for Margin Dashboard

## Problem Summary
The `margin_equity_snapshots` view returns zeros for holdings-related fields because the `eod_holding_snapshots` table is empty. The current EOD process only captures ledger data, not portfolio holdings.

## Solution Overview
Implement a two-part fix:
1. **Immediate Data Population**: Copy current holdings to `eod_holding_snapshots` for the latest EOD date
2. **EOD Function Enhancement**: Update `run_batch_eod` to capture holdings during future EOD runs

---

## Implementation Steps

### Step 1: Immediate Holding Snapshot Population
Create a database migration to populate `eod_holding_snapshots` from the current `holdings` table.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            Data Flow: Quick Fix                                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│   holdings (74,877 rows)                                                          │
│        │                                                                          │
│        │  INSERT INTO eod_holding_snapshots                                       │
│        │  SELECT investor_code, latest_eod_date, trading_code,                    │
│        │         saleable, total_stock, avg_cost, total_cost, market_value        │
│        ▼                                                                          │
│   eod_holding_snapshots (populated for latest EOD date)                           │
│        │                                                                          │
│        │  View now calculates correctly                                           │
│        ▼                                                                          │
│   margin_equity_snapshots (shows real marginable holdings)                        │
│                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**SQL Migration:**
```sql
-- Populate eod_holding_snapshots from current holdings for the latest EOD date
INSERT INTO eod_holding_snapshots (
  investor_code, eod_date, security_code, 
  total_qty_saleable, total_qty, avg_cost, total_cost, market_value
)
SELECT 
  h.investor_code,
  (SELECT MAX(eod_date) FROM eod_ledger_snapshots) AS eod_date,
  h.trading_code AS security_code,
  h.saleable AS total_qty_saleable,
  h.total_stock AS total_qty,
  h.avg_cost,
  h.total_cost,
  h.market_value
FROM holdings h
WHERE EXISTS (
  SELECT 1 FROM eod_ledger_snapshots e 
  WHERE e.investor_code = h.investor_code
)
ON CONFLICT (investor_code, eod_date, security_code) DO UPDATE SET
  total_qty_saleable = EXCLUDED.total_qty_saleable,
  total_qty = EXCLUDED.total_qty,
  avg_cost = EXCLUDED.avg_cost,
  total_cost = EXCLUDED.total_cost,
  market_value = EXCLUDED.market_value;
```

### Step 2: Update run_batch_eod Function
Enhance the EOD process to automatically capture holding snapshots during each run.

**Changes to `run_batch_eod`:**
1. After processing ledger calculations, snapshot all holdings for investors in the EOD universe
2. Delete and re-insert holdings for the EOD date to ensure accuracy
3. Map `holdings.trading_code` to `eod_holding_snapshots.security_code`

```sql
-- Add to run_batch_eod after ledger snapshot upsert:
DELETE FROM eod_holding_snapshots WHERE eod_date = p_eod_date;

INSERT INTO eod_holding_snapshots (
  investor_code, eod_date, security_code,
  total_qty_saleable, total_qty, avg_cost, total_cost, market_value
)
SELECT 
  h.investor_code,
  p_eod_date,
  h.trading_code,
  h.saleable,
  h.total_stock,
  h.avg_cost,
  h.total_cost,
  h.market_value
FROM holdings h
WHERE h.investor_code IN (SELECT inv_code FROM universe);
```

### Step 3: Verify Dashboard Data
After migration:
- The `margin_equity_snapshots` view will calculate real `marginable_after_haircut` values
- Dashboard KPIs will show actual portfolio values and margin ratios
- Pie chart will display accurate health distribution

---

## Technical Details

### Data Mapping
| holdings column | eod_holding_snapshots column |
|-----------------|------------------------------|
| investor_code   | investor_code                |
| trading_code    | security_code                |
| saleable        | total_qty_saleable           |
| total_stock     | total_qty                    |
| avg_cost        | avg_cost                     |
| total_cost      | total_cost                   |
| market_value    | market_value                 |

### Files to Modify
1. **Database Migration**: Create new migration for data population and function update
2. **No frontend changes needed** - Dashboard already queries the view correctly

### Expected Results After Implementation
- `eod_holding_snapshots`: ~74,877 rows for the latest EOD date
- `margin_equity_snapshots`: Holdings fields populated with real values
- Dashboard: KPIs showing actual portfolio values, margin ratios, and health distribution

---

## Estimated Impact
- **Portfolio Value KPI**: Will show actual collateral value
- **Margin Health Distribution**: Pie chart will show real Safe/Warning/Critical distribution
- **Top 10 Clients**: Table will show accurate margin ratios based on real holdings
