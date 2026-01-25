
# Plan: Fix Margin Dashboard Calculation Formulas

## Problem Analysis
The dashboard is showing incorrect values:
- **Average Margin Ratio**: 843564% (should be reasonable percentage based on Total Margin Outstanding / Total Portfolio Value)
- **Overall Utilization**: 0.0% (should be Total Margin Outstanding / Available Capacity)

## Root Cause

### Current Flawed Calculations:
1. **Average Margin Ratio** averages individual client ratios, which includes extreme outliers (clients with 999% or higher ratios)
2. **Overall Utilization** pulls from empty `margin_accounts` table instead of using snapshot data
3. **Available Capacity** is calculated as `totalEquity - totalExposure`, which doesn't align with the utilization formula

## Corrected Formulas

| Metric | Corrected Formula |
|--------|-------------------|
| Average Margin Ratio | `(Total Margin Outstanding / Total Portfolio Value) * 100` |
| Overall Utilization | `(Total Margin Outstanding / (Total Portfolio Value - Total Margin Outstanding)) * 100` or `(Total Margin Outstanding / Total Portfolio Value) * 100` depending on interpretation |
| Available Capacity | `Total Portfolio Value - Total Margin Outstanding` (remaining collateral capacity) |

### Expected Results Based on Current Data:
- Total Margin Outstanding: ~35.53 Cr
- Total Portfolio Value: ~198.36 Cr  
- **Average Margin Ratio**: (35.53 / 198.36) * 100 = **17.9%**
- **Available Capacity**: 198.36 - 35.53 = **162.83 Cr**
- **Overall Utilization**: (35.53 / 198.36) * 100 = **17.9%** or (35.53 / 162.83) * 100 = **21.8%**

## Implementation Changes

### File: `src/components/margin-loan/DashboardTab.tsx`

**1. Fix Average Margin Ratio Calculation (lines 171-174)**

Replace:
```typescript
// Average margin ratio (only for margin clients)
const avgMarginRatio = clientsWithRatio.length > 0
  ? clientsWithRatio.reduce((sum, c) => sum + c.marginRatio, 0) / clientsWithRatio.length
  : 0;
```

With:
```typescript
// Average Margin Ratio = (Total Margin Outstanding / Total Portfolio Value) * 100
const avgMarginRatio = totalPortfolioValue > 0
  ? (totalMarginOutstanding / totalPortfolioValue) * 100
  : 0;
```

**2. Fix Available Capacity Calculation (lines 181-183)**

Replace:
```typescript
// Available capacity = total equity - total exposure (simplified)
const totalExposure = clientsWithRatio.reduce((sum, c) => sum + c.exposure, 0);
const availableCapacity = Math.max(0, totalEquity - totalExposure);
```

With:
```typescript
// Available Capacity = Total Portfolio Value - Total Margin Outstanding
const availableCapacity = Math.max(0, totalPortfolioValue - totalMarginOutstanding);
```

**3. Add Overall Utilization to Snapshot Metrics (line 185-196)**

Add new field:
```typescript
// Overall Utilization = (Total Margin Outstanding / Total Portfolio Value) * 100
const overallUtilization = totalPortfolioValue > 0
  ? (totalMarginOutstanding / totalPortfolioValue) * 100
  : 0;

return {
  // ... existing fields
  overallUtilization,
};
```

**4. Update Overall Utilization Display (line 277-278)**

Replace:
```typescript
{accountsSummary?.avgUtilization?.toFixed(1) || 0}%
```

With:
```typescript
{snapshotMetrics.overallUtilization.toFixed(1)}%
```

## Technical Notes

- The `margin_accounts` table is currently empty, so we use the snapshot data directly
- Currency formatting already handles Cr/L conversion correctly via `formatCurrency()`
- Margin health distribution uses correct client-level calculations and should remain unchanged
- The individual client margin ratios (Equity/Exposure) in the table are still correct for risk assessment

## Expected Outcome After Fix

| KPI | Before | After |
|-----|--------|-------|
| Total Margin Outstanding | ৳35.53 Cr | ৳35.53 Cr (unchanged) |
| Total Portfolio Value | ৳198.36 Cr | ৳198.36 Cr (unchanged) |
| Overall Utilization | 0.0% | ~17.9% |
| Average Margin Ratio | 843564% | ~17.9% |
| Available Capacity | ৳130.89 Cr | ~৳162.83 Cr |
| High-Risk Clients | 28 | 28 (unchanged) |
| Total Interest Accrued | ৳1.86 L | ৳1.86 L (unchanged) |
