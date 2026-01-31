

# Unified EOD Data Import: Add Deposits/Withdrawals to EOD Page

## Summary

Consolidate all daily data imports into the EOD page by adding a **Deposits/Withdrawals Import** dialog alongside the existing Trade Import. This creates a single workflow hub where operators can:
1. Import trade files (CSE `.txt` + DSE `.xml`)
2. Import deposits/withdrawals (Excel)
3. Run EOD processing

This eliminates the need to visit the Trade History page for deposits/withdrawals.

---

## Architecture Overview

```
EOD Page Workflow
┌────────────────────────────────────────────────────────────┐
│  1. Select Date                                            │
├────────────────────────────────────────────────────────────┤
│  2. Import Data                                            │
│     ┌─────────────────────┐  ┌─────────────────────────┐   │
│     │ Import Trade Data   │  │ Import Deposits/        │   │
│     │ (CSE .txt + DSE    │  │ Withdrawals (.xlsx)     │   │
│     │  .xml)              │  │                         │   │
│     └─────────────────────┘  └─────────────────────────┘   │
├────────────────────────────────────────────────────────────┤
│  3. Run Full EOD (reads from deposits_withdrawals table)   │
└────────────────────────────────────────────────────────────┘
```

---

## Changes Required

### 1. New Component: `DepositsImportDialog.tsx`

Create a new dialog component in `src/components/eod/` that handles deposits/withdrawals import with the same UX pattern as TradeImportDialog.

**Features to include:**
- Excel file upload (`.xlsx`, `.xls`)
- Flexible column mapping (handles various column name formats)
- File date extraction from embedded "Date : DD-MMM-YYYY" headers
- Transaction type normalization (Receipt → Deposit, Payment → Withdrawal)
- Duplicate detection using count-based comparison
- Preview dialog before final import
- Insert into `deposits_withdrawals` table

**Logic to port from DepositsWithdrawalsTable.tsx:**
- `handleFileUpload` function (lines 288-654)
- `parseNumber` helper
- `normalizeTransactionType` helper
- Date parsing logic (Excel serial numbers, DD/MM/YYYY, DD-MMM-YYYY)
- Duplicate detection using `get_deposit_withdrawal_counts` RPC

### 2. Update `EodActionButtons.tsx`

Add a new button for importing deposits/withdrawals:

| Current Buttons | After |
|-----------------|-------|
| Import Trade Data | Import Trades |
| Process Staged Trades | **Import Deposits/Withdrawals** (NEW) |
| Calculate Settlements | Process Staged Trades |
| Run Full EOD | Calculate Settlements |
| Generate Report | Run Full EOD |
| Clear Selected | Generate Report |
| | Clear Selected |

**New prop:** `onImportDeposits: () => void`

### 3. Update `EodPage.tsx`

Add state and handler for the deposits import dialog:

```typescript
// New state
const [depositsDialogOpen, setDepositsDialogOpen] = useState(false);

// New handler
const handleImportDeposits = () => {
  setDepositsDialogOpen(true);
};

// Add to render
<DepositsImportDialog
  open={depositsDialogOpen}
  onOpenChange={setDepositsDialogOpen}
  onImportComplete={() => {
    queryClient.invalidateQueries({ queryKey: ["eod-run-history"] });
    toast.success("Ready to run EOD");
  }}
/>
```

### 4. Reuse `ImportPreviewDialog.tsx`

The existing `ImportPreviewDialog` component is already well-designed for deposits/withdrawals preview. It will be reused directly in the new `DepositsImportDialog`.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/eod/DepositsImportDialog.tsx` | **CREATE** | New dialog for deposits/withdrawals import |
| `src/components/eod/EodActionButtons.tsx` | MODIFY | Add "Import Deposits/Withdrawals" button |
| `src/pages/EodPage.tsx` | MODIFY | Add state and dialog for deposits import |

---

## DepositsImportDialog Component Structure

```typescript
// Props
interface DepositsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

// Steps
type ImportStep = "upload" | "analyzing" | "preview" | "importing" | "complete";

// Key features:
// 1. Upload .xlsx/.xls file
// 2. Parse and validate records using DepositsWithdrawalsRecordSchema
// 3. Detect duplicates via RPC call
// 4. Show preview with totals
// 5. Insert unique records
// 6. Show completion summary
```

---

## Workflow After Implementation

**Daily EOD Operator Workflow (Single Page):**

1. Navigate to `/eod`
2. Select the EOD date
3. Click **"Import Trades"** → Upload CSE `.txt` or DSE `.xml` file
4. Click **"Import Deposits/Withdrawals"** → Upload Excel file from bank/treasury
5. Click **"Run Full EOD"** → System reads from `deposits_withdrawals` table and calculates snapshots
6. Review summary and logs

**Benefits:**
- Single-page workflow for all daily data
- No need to navigate to Trade History page
- Consistent UX with preview dialogs
- Duplicate detection prevents double-imports

---

## Technical Notes

1. **Duplicate Detection**: Uses the existing `get_deposit_withdrawal_counts` RPC function which compares (investor_code, amount, transaction_type, date) tuples

2. **Transaction Type Mapping**:
   - Receipt, Credit, Deposit → "Deposit"
   - Payment, Debit, Withdrawal → "Withdrawal"

3. **Date Parsing Priority**:
   - First: File header date ("Date : 12-Jan-2026")
   - Second: Row-level date column
   - Fallback: Current date

4. **Validation**: Uses existing `DepositsWithdrawalsRecordSchema` from `validation-schemas.ts`

