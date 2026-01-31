
# Remove DP Code Prefix from CSE Investor Code

## Summary

Currently CSE trades show investor codes like `01GZ44` (DP code + investor code concatenated). You want just the raw investor code (`GZ44`) since the exchange source is tracked separately.

---

## Change Required

### File: `src/components/eod/TradeImportDialog.tsx`

**Line 167** - Change the full investor code assignment:

```typescript
// Before
const fullInvestorCode = dpCode + investorCode;

// After  
const fullInvestorCode = investorCode;
```

This single change will:
- Display `GZ44` instead of `01GZ44` in the preview table
- Store `GZ44` as the investor code in the database
- Keep the `dp_code` field populated separately (for reference if needed)
- Keep `cse_terminal` field showing the exchange source (CSE01, CSE02, etc.)

---

## Data Already Tracked

The exchange origin is already captured via:
- `cse_terminal` column: Shows `CSE01`, `CSE02`, etc.
- `exchange` column: Shows `CSE` or `DSE`

So the DP code prefix is redundant for identification purposes.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/eod/TradeImportDialog.tsx` | Line 167: Use `investorCode` instead of `dpCode + investorCode` |
