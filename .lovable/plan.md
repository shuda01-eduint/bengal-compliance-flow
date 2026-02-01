
# Add Separate Import Buttons for DSE, CSE, and Deposits

## Overview
Replace the single "Import Trades" button with two separate buttons ("Import DSE Trades" and "Import CSE Trades") and keep the existing "Import Deposits / Withdrawals" button. Wire these to new backend edge functions that handle the import logic server-side.

---

## Current State
- Single `TradeImportDialog` handles both DSE XML and CSE TXT files client-side
- `DepositsImportDialog` handles deposits/withdrawals client-side  
- No edge functions exist for trade imports

## Changes Required

### 1. Create Three New Edge Functions

**`supabase/functions/import-dse-trades/index.ts`**
- Accepts: `{ trade_date: string, xml_content: string, replace_existing?: boolean, run_cse_too?: boolean }`
- Parses DSE XML format (Excel-style Row/Cell or Detail attributes)
- Inserts into `trade_file` table with `exchange_code = 'DSE'`
- If `replace_existing`, deletes existing DSE records for the date first
- If `run_cse_too`, can optionally trigger CSE import as well
- Returns: `{ success, trade_count, gross_buy, gross_sell }`

**`supabase/functions/import-cse-trades/index.ts`**  
- Accepts: `{ trade_date: string, txt_content: string, replace_existing?: boolean }`
- Parses CSE pipe-delimited TXT format
- Inserts into `trade_file` table with exchange_code from terminal (DHK01, CTG01, etc.)
- If `replace_existing`, deletes existing CSE records for the date first
- Returns: `{ success, trade_count, gross_buy, gross_sell }`

**`supabase/functions/import-deposits-withdrawals/index.ts`**
- Accepts: `{ txn_date: string, records: Array<{investor_code, type, amount}>, replace_existing?: boolean }`
- Inserts into `cash_ledger_txn` table
- If `replace_existing`, deletes existing records for the date first
- Returns: `{ success, deposit_count, withdrawal_count, total_deposits, total_withdrawals }`

### 2. Update EodActionButtons Component

**File: `src/components/eod/EodActionButtons.tsx`**

Replace single "Import Trades" button with two buttons:
- "Import DSE Trades" - triggers DSE XML import dialog
- "Import CSE Trades" - triggers CSE TXT import dialog
- Keep "Import Deposits/Withdrawals" as-is

Add new props:
```typescript
onImportDseTrades: () => void;
onImportCseTrades: () => void;
```

Remove old prop:
```typescript
// Remove: onImportTrades: () => void;
```

### 3. Create Separate Import Dialogs

**`src/components/eod/DseTradeImportDialog.tsx`**
- File picker for XML files only
- Preview parsed trades before import
- "Replace existing" checkbox
- Calls edge function `import-dse-trades`

**`src/components/eod/CseTradeImportDialog.tsx`**
- File picker for TXT files only  
- Preview parsed trades before import
- "Replace existing" checkbox
- Calls edge function `import-cse-trades`

### 4. Update EodPage

**File: `src/pages/EodPage.tsx`**

- Add state for both new dialogs
- Wire up handlers to call appropriate edge functions
- Keep deposits dialog as-is

---

## File Summary

| File | Action |
|------|--------|
| `supabase/functions/import-dse-trades/index.ts` | Create new |
| `supabase/functions/import-cse-trades/index.ts` | Create new |
| `supabase/functions/import-deposits-withdrawals/index.ts` | Create new |
| `src/components/eod/DseTradeImportDialog.tsx` | Create new |
| `src/components/eod/CseTradeImportDialog.tsx` | Create new |
| `src/components/eod/EodActionButtons.tsx` | Modify |
| `src/pages/EodPage.tsx` | Modify |
| `src/components/eod/TradeImportDialog.tsx` | Keep (can remove later) |

---

## Technical Notes

### Edge Function API Signatures
```
POST /functions/v1/import-dse-trades
Body: { trade_date, xml_content, replace_existing?, run_cse_too? }

POST /functions/v1/import-cse-trades  
Body: { trade_date, txt_content, replace_existing? }

POST /functions/v1/import-deposits-withdrawals
Body: { txn_date, records, replace_existing? }
```

### Security
- All edge functions require JWT authentication
- Admin role check before allowing imports
- Input validation using Zod schemas
- String sanitization to prevent formula injection

### Data Flow
1. User selects file in dialog
2. File is read as text in browser
3. Content sent to edge function
4. Edge function parses, validates, and inserts
5. Result returned to UI for display
