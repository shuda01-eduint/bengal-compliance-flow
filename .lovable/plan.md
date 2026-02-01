
## What’s happening (confirmed from your database)
Right now **January 31, 2026 is not selectable** on `/admin/balances` because that date-picker only allows dates returned by the backend function `get_balance_dates()`, which reads **only from** `balances_raw`.

I checked the database:

- `eod_investor_balance` **does** have Jan 31 data: **23,961 rows** for `2026-01-31`
- `balances_raw` **does NOT** have Jan 31 data: **0 rows** for `2026-01-31`
- Latest date in `balances_raw` is **2026-01-12** (only 5 distinct dates exist there)

So the baseline import created the baseline in the EOD baseline table, but **the “Admin Balances view table” (`balances_raw`) did not get populated for Jan 31**, which is why the date stays disabled.

---

## Most likely reasons (and how we’ll prevent them)
1) **The baseline import you ran was done before the “sync to balances_raw” fix was live**, so Jan 31 never got inserted into `balances_raw`.
2) Or the sync step ran but **failed silently / wasn’t obvious**, so you thought it succeeded.

Either way, we need to ensure `balances_raw` is populated for Jan 31, and the UI refreshes.

---

## Immediate recovery (fastest path for you)
### Option A (recommended): Re-import the baseline for Jan 31
1. Go to `/admin/balances`
2. Open **Import Admin Balance Baseline**
3. Select **Jan 31, 2026**
4. Upload the same Admin Balance Excel again
5. Run import and wait until it shows **“Syncing to Admin Balances view…”** and completes

After that, Jan 31 will appear in the selectable dates because `balances_raw` will finally have rows for that date.

### Option B (fallback): Add a “Sync only” tool so you don’t need to re-upload
If you no longer have the file handy (or want a safer repair tool), we’ll add a button that backfills `balances_raw` for a chosen date using backend logic.

---

## Implementation changes to make this reliable (what I will change)
### 1) Make “sync to balances_raw” unavoidable + earlier in the workflow
Currently the sync happens at the end (Step 6). If anything fails earlier, it may never happen.

Change order so that **after parsing and deduplicating**, we run:

- Insert baseline to `eod_investor_balance`
- Immediately sync to `balances_raw` (so the date becomes selectable ASAP)
- Then do optional investor updates / holdings replace

### 2) Make the balances_raw delete safer (avoid timeouts)
Right now it uses:
- `delete().eq("as_of_date", dateStr)`

For large dates (80k+ rows), this can time out. We will switch to a safer approach:
- batched delete (like `ImportBalancesRawDialog` already does), OR
- a backend “delete by date in batches” function

### 3) Improve error visibility: if balances_raw sync fails, it must be obvious
We’ll:
- show a dedicated “Balances view sync” section in the results
- if balances_raw insert fails, show a clear error like:
  - “Baseline imported, but Admin Balances date will NOT be selectable until sync succeeds.”

### 4) Force the dates list to refresh even if there are minor import errors
Right now `onSuccess()` is only called when there are **zero** errors.
That means if something minor fails (like some commission updates), the UI may not refresh the dates list even if the sync succeeded.

We’ll change the logic to:
- call the “refresh” callback when the **balances_raw sync succeeds**, even if other steps had warnings/errors.

---

## How we’ll verify the fix
1) After importing Jan 31, confirm in the backend:
   - `balances_raw` contains rows where `as_of_date = '2026-01-31'`
2) In UI:
   - Jan 31 becomes selectable in the `/admin/balances` date picker immediately (or after auto refresh)
3) Reload the page as a final sanity check:
   - Jan 31 should still be selectable after refresh

---

## Technical notes (for completeness)
- `/admin/balances` date picker uses:
  - `availableDates` from RPC `get_balance_dates()` and disables any date not in that list.
- `get_balance_dates()` reads distinct dates from `balances_raw`, so **no `balances_raw` rows = date not selectable**.

