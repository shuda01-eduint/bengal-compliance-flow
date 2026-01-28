
## Fix Frontend EOD Verification Logic

### Problem Analysis

The "Stale EOD Data Detected" warning is a **false positive**. Database verification confirmed:

1. **Backend is working correctly**: The `run_batch_eod` function properly sets `opening_balance = previous day's closing_balance`
2. **EOD chain is intact**: Query confirmed zero mismatches between `opening_balance` and `prev_closing` in the database
3. **Root cause**: Frontend verification in `BatchEodRunner.tsx` uses incorrect data sources

### Current Frontend Bug

The verification function (`verifyPreviousDayEod`) has these issues:

| Issue | Current Code | Problem |
|-------|--------------|---------|
| Wrong field | `select("investor_code, ledger_balance")` | Should use `closing_balance` for chain verification |
| Wrong date | Fetches from `twoDaysBefore` | Should fetch from `prevDay` (immediate previous EOD) |
| Stale fallback | Uses `clients.ledger_balance` as base | This is static import data, not EOD chain data |

### Solution

Fix the frontend verification to match the backend logic:

1. **Fetch previous day's EOD closing balance** (not 2 days before)
2. **Use `closing_balance` field** (not `ledger_balance`)
3. **Remove stale `clients.ledger_balance` fallback** for verification purposes
4. **For clients without previous EOD**: Use 0 as opening balance (matching backend COALESCE behavior)

### Technical Implementation

```text
┌─────────────────────────────────────────────────────────────────┐
│                 VERIFICATION LOGIC FIX                          │
├─────────────────────────────────────────────────────────────────┤
│ Before (Incorrect):                                             │
│   base = clients.ledger_balance OR eod[T-2].ledger_balance      │
│   expected = base + deposits - withdrawals + sells - buys       │
│                                                                 │
│ After (Correct):                                                │
│   base = eod[T-1].closing_balance (immediate previous day)      │
│   expected = base + deposits - withdrawals + sells - buys       │
└─────────────────────────────────────────────────────────────────┘
```

### Changes Required

**File: `src/components/trade-history/BatchEodRunner.tsx`**

1. **Update base EOD fetch** (around line 235-245):
   - Change date from `twoDaysBefore` to `prevDay`
   - Change field from `ledger_balance` to `closing_balance`

2. **Remove clients table fetch** (lines 247-256):
   - The `clients.ledger_balance` is stale import data
   - Not needed for EOD chain verification

3. **Update base balance mapping** (lines 279-287):
   - Use only EOD closing balance from previous day
   - Default to 0 for investors without previous EOD (new accounts)

4. **Keep deposit/withdrawal logic** unchanged:
   - The trade_history embedded values are correct

### Expected Outcome

After this fix:
- The verification will correctly compare against the EOD chain
- "Stale EOD Data" warnings will only appear for genuine mismatches
- False positives will be eliminated

### Verification After Fix

Re-run EOD for Jan 26 and confirm:
- Warning should not appear (or show only genuine issues)
- `ledger_balance_snapshot` mismatches are expected (file snapshot vs calculated opening) and are for audit purposes, not blocking
