
## What’s happening (why investor 3008 still shows portfolio value = 0)

- Your holdings snapshots are **huge** for the latest holdings date (**~74,877 rows** on 2026-01-28).
- In the current code, the Client Accounts tab runs:

  - Fetch ledger snapshots for the selected/latest date (fine)
  - Fetch **all holdings rows for that date**:
    - `select investor_code, market_value where eod_date = holdingDate`

- The backend API has a **default 1000-row cap per request**.  
  So the “all holdings rows” request returns only the **first 1000** holdings rows (arbitrary order), which often **does not include investor 3008**, so the app thinks 3008 has no holdings and shows 0.

We confirmed in the database that investor **3008 does have holdings**:
- `eod_holding_snapshots` for 3008 on 2026-01-28 totals **23,706,100** (≈ ৳2.37 Cr).

## Goal

Make portfolio values reliable by ensuring the holdings query:
1) only fetches holdings for the investors currently being displayed (or searched), and  
2) paginates through results so we don’t lose rows to the 1000-row cap.

## Implementation approach (no backend changes)

### 1) Change holdings fetch to only request holdings for the ledger investors we already fetched
In `src/components/margin-loan/ClientAccountsTab.tsx`, after `ledgerData` is loaded:

- Build a unique list:
  - `const investorCodes = [...new Set((ledgerData ?? []).map(r => r.investor_code))];`

- Fetch holdings using:
  - `.eq('eod_date', holdingDate)`
  - `.in('investor_code', investorCodes)`

This alone will fix the “search 3008 => portfolio 0” case because the holdings request becomes tiny (only holdings rows for that investor).

### 2) Add pagination for the holdings query using `.range(from, to)`
Even after filtering by investorCodes, the result can still exceed 1000 rows (many investors × multiple securities). So we will:

- Set `PAGE_SIZE = 1000`
- Loop:
  - request `.range(offset, offset + PAGE_SIZE - 1)` with a stable `.order(...)`
  - append results
  - stop when returned rows `< PAGE_SIZE`

This guarantees we fetch the complete holdings set for the current investorCodes list.

### 3) (Small UX clarity) Show which holdings date is being used
Because ledger date and holdings date can differ, we’ll optionally display something like:
- “Portfolio values as of: Jan 28, 2026” next to the As-Of selector, when holdings lag behind.

This reduces “why doesn’t it match” confusion.

## Files to change

- `src/components/margin-loan/ClientAccountsTab.tsx`
  - Update holdings query:
    - add `.in('investor_code', investorCodes)`
    - add pagination loop with `.range()`
    - (optional) show holdings date used in the UI

## Testing checklist (what you should verify in the UI)

1) Go to **Margin Loan → Client Accounts**
2) Search **3008**
3) Confirm **Portfolio Value ≈ ৳2.37 Cr** (not 0)
4) Clear search and try a few random investors; verify portfolio values are no longer frequently 0 (unless they truly have no holdings)
5) Switch As-Of date and confirm portfolio value follows the latest available holdings snapshot ≤ that date

## Notes / constraints

- This fix stays fully “frontend-only” and avoids any backend/schema changes.
- It also improves performance because we stop fetching tens of thousands of holdings rows when the user is just viewing a small filtered subset (like searching a single investor).
