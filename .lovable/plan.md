
Goal
- Fix the “Negative Balance (Cash)” card so it strictly excludes margin accounts and returns the full result set (not capped/truncated), while keeping Days Negative + Department working.

What I found (from the current backend + live queries)
- The investors table does NOT have acc_type, and does NOT have a code column.
  - It has: investors.investor_code, investors.account_type, investors.department, investors.status, etc.
- investors.account_type values are:
  - “Cash” (~30,659 rows)
  - “Margin” (~1,440 rows)
  - NULL (~175 rows)
- Current SQL filter in both of your “cash negative” functions is:
  - inv.account_type != 'M' (or NULL/empty)
  - This does NOT exclude “Margin”, so margin accounts are currently included.
- Proof: get_all_negative_cash_balances currently returns 4,994 rows for the latest date, and 313 of those rows are margin accounts (account_type = 'Margin').
- I also saw the frontend request try to fetch up to 10,000 rows in one call and hit a database statement timeout in the browser network log. So we need to avoid “one huge fetch” patterns.

Root causes
1) Wrong margin exclusion logic
- Your data uses investors.account_type = 'Margin' (not 'M').
- So checking only != 'M' lets “Margin” through.

2) Fetching large result sets in one request is brittle
- The UI currently requests a very large limit (limit=10000). Even though the function returns ~5k rows, the query + serialization can exceed the backend timeout in the browser context.
- If we page the results (e.g., 1000 at a time), we avoid timeouts and also bypass any max-rows constraints.

Plan (what I will change)

A) Backend (database function) fix: exclude Margin correctly
- Update BOTH RPCs used by the violations page:
  1) public.get_all_negative_cash_balances(p_target_date date)
  2) public.get_negative_balance_codes(p_from_date date, p_to_date date, p_search text, p_lookback_days int)

- Replace the current filter:
  - (inv.account_type IS NULL OR inv.account_type = '' OR inv.account_type != 'M')
- With a robust “exclude margin” filter that matches your real data:
  - inv.account_type IS NULL
    OR trim(inv.account_type) = ''
    OR upper(trim(inv.account_type)) NOT IN ('M', 'MARGIN')

- (Optional safety) Also consider excluding if the snapshot itself says “Margin”:
  - upper(trim(els.account_type)) NOT IN ('M','MARGIN')
  - This protects you if investors.account_type is missing/incorrect for any records.

- Keep existing “exclude CLOSED accounts” rule and existing date-snapping logic.

Expected outcome after this change
- “All Negative (Cash)” count should drop by exactly the number of margin negatives currently leaking in.
  - Based on current data: 4,994 total negatives, 313 are margin ⇒ expected cash-only ≈ 4,681.

B) Frontend fix: fetch results in pages (prevents timeouts and hard caps)
- In src/hooks/useViolations.ts, for both negative-balance RPC calls:
  - get_all_negative_cash_balances (mode: “all”)
  - get_negative_balance_codes (mode: “new_only”)
- Replace the single call with .range(0, 9999) with a small “fetch all pages” helper:
  - pageSize = 1000 (or 500 if needed)
  - loop:
    - request .range(offset, offset + pageSize - 1)
    - append results
    - stop when returnedRows < pageSize
    - add a hard stop like maxPages = 20 to avoid infinite loops

Why this is important
- It avoids the “statement timeout” seen in your network logs.
- It ensures the card/table/export can show the full dataset reliably.

C) Verification steps (I’ll do these after implementing)
1) Backend sanity checks
- Confirm the investors schema/values:
  - distinct account_type values are Cash/Margin/NULL
- Confirm function output contains 0 margin rows:
  - call get_all_negative_cash_balances(latest_date) and verify none of the returned client_codes have investors.account_type='Margin'

2) UI verification on /violations
- Set Negative Balance mode = “All Negative”
  - Verify the count is ~4.6k (not 1000)
  - Spot-check several client codes that are known margin accounts (previously appearing) no longer show
  - Days Negative + Department columns still render
- Toggle to “New Only”
  - Verify margin accounts are excluded here too
- Export Excel
  - Ensure export includes the same row count shown in the table (and doesn’t error)

Risks / edge cases
- If there are other margin representations besides “Margin” (e.g., “M ”, “margin”), the TRIM+UPPER logic covers them.
- Paging means more requests; but at ~5k rows it should be ~5 calls, which is acceptable and far more stable than a single large call.
- If we still see timeouts even with paging (unlikely), we’ll additionally optimize the SQL by adding a partial index on eod_ledger_snapshots for negative balances (safe, non-destructive).

Files/functions that will be updated (implementation phase)
- Database migration:
  - Update function definitions for:
    - public.get_all_negative_cash_balances(date)
    - public.get_negative_balance_codes(date, date, text, integer)
- Frontend:
  - src/hooks/useViolations.ts (add paged RPC fetching for negative-balance queries)
