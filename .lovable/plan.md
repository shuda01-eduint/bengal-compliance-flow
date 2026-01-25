

## Update Treemap Box Labels to Show Size Proportion

### Summary
Update the Margin Distribution treemap to display the **percentage of total margin outstanding** inside each box instead of the margin ratio. The margin ratio will continue to be used for box coloring (risk levels), but the displayed percentage will represent each RM's share of the total exposure.

---

### Changes Required

**File: `src/components/margin-loan/DashboardTab.tsx`**

1. **Calculate total margin outstanding in the hierarchy builder**
   - Sum all `margin_outstanding` values from the filtered data
   - Calculate each RM's percentage: `(rm.margin_outstanding / totalMarginOutstanding) * 100`
   - Store this as a new field `size_percentage` on each treemap node

2. **Update TreemapNode interface**
   - Add `size_percentage?: number` field to store the proportion

3. **Update CustomTreemapContent renderer**
   - Change the displayed text from `margin_ratio` percentage to `size_percentage`
   - Keep the coloring logic based on `margin_ratio` (for risk indication)
   - Display format: `XX%` representing share of total exposure

4. **Update tooltip to clarify the metrics**
   - Show "Share of Total: XX%" for the size percentage
   - Keep "Margin Ratio: XX%" for the risk indicator

---

### Technical Details

```text
Current Display:
┌─────────────────┐
│   RM Name       │
│     167%        │  <-- This is margin ratio (WRONG)
└─────────────────┘

Updated Display:
┌─────────────────┐
│   RM Name       │
│     15%         │  <-- This is % of total exposure (CORRECT)
└─────────────────┘
(Color still based on margin ratio for risk indication)
```

**Calculation Logic:**
```typescript
const totalMarginOutstanding = filteredData.reduce(
  (sum, rm) => sum + (Number(rm.margin_outstanding) || 0), 0
);

// For each RM:
size_percentage: totalMarginOutstanding > 0 
  ? ((Number(rm.margin_outstanding) || 0) / totalMarginOutstanding) * 100 
  : 0
```

---

### Visual Behavior

| Component | Before | After |
|-----------|--------|-------|
| Box Label | Shows margin ratio (167%, 34%, etc.) | Shows share of total (15%, 8%, etc.) |
| Box Color | Based on margin ratio | No change (still based on margin ratio) |
| Tooltip | Shows margin ratio | Shows both: Share % and Margin Ratio % |

