
Problem recap (what’s actually happening right now)
- The “Failed: 1” is real: the backend call to run EOD is failing, so EOD is not recomputing totals for that date.
- In the browser network log, the RPC response from `run_batch_eod` is:
  - `{"success": false, "error": "column \"created_by\" is of type uuid but expression is of type text", "error_detail": "42804"}`
- Separately, the “Withdrawals: ৳0” can still show even when your cash ledger has withdrawals, because:
  1) the EOD run is failing (so nothing new is calculated), and/or
  2) the “Process Staged Trades” backend function currently looks for `type = 'WITHDRAWAL'`, but your importer is inserting `type = 'WITHDRAW'` (so staged withdrawals sum to 0 even though the data exists).

Evidence from backend data
- For 2026-02-01 in `cash_ledger_txn`, the data is correct:
  - DEPOSIT: 201 rows, total ≈ 338,239,927.57
  - WITHDRAW: 167 rows, total ≈ 168,795,365.17
- So the problem is not the Excel parsing anymore; it’s backend calculation + an EOD failure.

Goals
1) Make EOD run succeed (fix the `created_by` uuid/text mismatch).
2) Make withdrawals sum correctly (use `type`-based logic, and accept both WITHDRAW and WITHDRAWAL defensively).
3) Ensure the UI summary reflects the correct source (staged vs batch), and does not show stale staged numbers when you run full EOD.

Plan (implementation)

A) Backend fixes (database migrations)
A1) Fix `run_batch_eod` so it can’t fail on created_by
- Update `run_batch_eod` INSERT into `eod_ledger_snapshots`:
  - Set `created_by = auth.uid()` (uuid), not email text.
  - Keep storing the user email in `eod_run_history.run_by_email` only.
- Add `SET statement_timeout = '300s'` and `SET search_path = public` for safety and consistency.

A2) Ensure `run_batch_eod` calculates withdrawals correctly from `cash_ledger_txn`
- In both:
  - the summary totals (v_total_deposits / v_total_withdrawals), and
  - the per-investor `today_cash` aggregation,
  use:
  - Deposits: `UPPER(TRIM(type)) = 'DEPOSIT'`
  - Withdrawals: `UPPER(TRIM(type)) IN ('WITHDRAW', 'WITHDRAWAL')`
- This makes the function compatible with both historical naming and the current importer output.

A3) Restore/keep the “commission from investor rate” logic inside `run_batch_eod`
- Your latest `run_batch_eod` definition currently uses `SUM(commission)` from `trade_file` (which is often 0), so commission can regress again.
- Update `today_trades` to compute commission using the normalized brokerage rate (same normalization logic you already approved earlier):
  - >= 0.1 → /100
  - between 0 and 0.1 → use as-is
  - null/other → default 0.004
- Also ensure the top-level returned `total_commission` is computed consistently (either recompute from inserted snapshots or aggregate from the computed trades CTE).

A4) Fix `process_staged_trades` withdrawals logic (staged summary)
- Update `process_staged_trades` in TWO places:
  1) `cash_agg` CTE: change `type = 'WITHDRAWAL'` to `UPPER(TRIM(type)) IN ('WITHDRAW','WITHDRAWAL')`
  2) the later “deposit/withdrawal stats” section: same change for counts and totals
- This ensures the “Process Staged Trades” path also shows ~৳168.8M withdrawals.

(Option, recommended) A5) One-time data normalization (safe, non-destructive)
- Add an idempotent UPDATE that standardizes:
  - `type='WITHDRAWAL'` → `type='WITHDRAW'`
  - `type='DEPOSIT '` → `type='DEPOSIT'` (trim issues)
- This reduces future mismatches, but we’ll still keep the defensive `IN ('WITHDRAW','WITHDRAWAL')` logic.

B) Frontend fixes (so the screen reflects the right numbers)
B1) Prevent “staged result overrides batch result”
- In `EodPage.tsx`, when “Run Full EOD” starts:
  - set `stagedResult` to `null` (or track a `summarySource` state).
- Today, if a staged result exists, `EodSummaryCards` uses it via `stagedResult?.total_withdrawals ?? summary.totalWithdrawals`, which can mask correct batch totals (or keep showing 0 from the staged bug).

B2) Show clearer error details when EOD fails
- When the RPC returns `success=false`, show the full message prominently (not only via toast):
  - Example: an inline Alert component above the summary saying:
    “EOD failed: created_by must be a user id (uuid).”
- This makes it obvious that the totals are not from a successful EOD calculation.

(Option) B3) Add a “Cash Ledger Preview” for the selected date
- A lightweight panel that queries `cash_ledger_txn` for the selected date and shows:
  - Deposit count/sum
  - Withdrawal count/sum
- This gives you a pre-flight check before running EOD and helps isolate “import vs EOD” issues instantly.

C) Verification steps (end-to-end)
1) On /eod, pick Feb 01, 2026.
2) Click “Process Staged Trades”
   - Expect: Deposits ≈ ৳338.24M, Withdrawals ≈ ৳168.80M
3) Click “Run Full EOD”
   - Expect: Failed: 0, Completed: 1
   - Expect: Cash Flow Summary shows deposits ≈ ৳338.24M and withdrawals ≈ ৳168.80M; Net Flow ≈ +৳169.44M
4) Confirm EOD history row for 2026-02-01 has `total_withdrawals` populated (not 0).

Risks / edge cases to handle
- Type naming inconsistencies (WITHDRAW vs WITHDRAWAL) are already present across older backend logic; we’ll code defensively and optionally normalize.
- If the EOD chain depends on “previous day”, keep using “latest prior EOD date” logic to handle weekends/holidays.
- Ensure the revised `run_batch_eod` doesn’t reintroduce the old “withdrawals from negative amounts” bug and doesn’t regress commission again.

Scope note (“other requested features”)
- I’ll implement the core fixes above immediately.
- If you list the “other requested features” you want on the EOD page (2–4 bullet points), I’ll fold them into the same implementation pass where possible.
