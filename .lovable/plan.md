

# Simplify Import Baseline Balances Section

## Overview

Remove the redundant import dialogs from the EOD page's "Import Baseline Balances" section, keeping only:
1. **Import Admin Balance Baseline** - for initial baseline where opening equals closing
2. **Copy to Date** - to copy balances forward to new dates

## Changes Required

### File: `src/pages/EodPage.tsx`

**1. Remove unused imports (lines 21, 23)**
- Remove: `ImportBalancesRawDialog` import
- Remove: `ImportOpeningBalancesDialog` import  
- Remove: `FileSpreadsheet` and `Upload` icons (if no longer used elsewhere)

**2. Remove state and useEffect for availableBalanceDates (lines 119-136)**
- Since `ImportBalancesRawDialog` is being removed, the `availableBalanceDates` state and the `useEffect` that fetches them may be simplified or adjusted based on whether `CopyBalancesDialog` still needs them

**3. Simplify the Baseline Balances Card section (lines 471-519)**

Current structure with 4 buttons:
```jsx
<ImportAdminBalanceDialog />
<ImportBalancesRawDialog />      // REMOVE
<CopyBalancesDialog />
<ImportOpeningBalancesDialog />  // REMOVE
```

New structure with 2 buttons:
```jsx
<ImportAdminBalanceDialog />
<CopyBalancesDialog />
```

## Summary of Removals

| Item | Action |
|------|--------|
| `ImportBalancesRawDialog` import | Remove |
| `ImportOpeningBalancesDialog` import | Remove |
| `<ImportBalancesRawDialog />` component usage | Remove |
| `<ImportOpeningBalancesDialog />` component usage | Remove |
| Unused icon imports (`FileSpreadsheet`, `Upload`) | Remove if not used elsewhere |

## Result

The "Import Baseline Balances" section will be cleaner with just two focused actions:
- **Import Admin Balance Baseline** (yellow button) - For establishing the initial baseline
- **Copy to Date** (dark button) - For copying existing balances forward

