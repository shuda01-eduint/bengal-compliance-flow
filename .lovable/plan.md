

# Fix CSE Trade Parser: Trade ID Prefix Should Be Investor Code

## Problem

The current parser incorrectly interprets **Field 7 (index 6)** as a "Trade ID Prefix" when it is actually the **Investor Code**. For example:

| Terminal | Security | Side | Qty | Price | **Current: Trade ID** | **Correct: Investor Code** |
|----------|----------|------|-----|-------|----------------------|---------------------------|
| DHK01 | LOVELLO | S | 35000 | 65.00 | GZ44 | GZ44 |
| DHK05 | SPCERAMICS | B | 1000 | 14.80 | NJ21 | NJ21 |
| DHK11 | BEACONPHAR | B | 41000 | 95.50 | 13657 | 13657 |

The user confirmed: **"GZ44 is the investor code"** - these codes like GZ44, NJ21, NJ130, 13657 are client/investor identifiers.

## File Format Correction

The actual CSE pipe-delimited format:

```
DHK01|LOVELLO|S|35000|65.00|GZ44|||13/01/2026|10:11:38|13/01/2026|10:11:38|B
```

| Index | Field | Example | Current Interpretation | Correct Interpretation |
|-------|-------|---------|------------------------|------------------------|
| 0 | CSE Terminal | DHK01 | Board+DP | CSE Terminal |
| 1 | Security | LOVELLO | Investor Code | Security Code |
| 2 | Side | S | Instrument | Side (B/S) |
| 3 | Quantity | 35000 | Side | Quantity |
| 4 | Price | 65.00 | Quantity | Price |
| 5 | **Investor Code** | GZ44 | Price | **Investor Code** |
| 6 | Trade ID Prefix | - | **Trade ID Prefix** | (empty or other) |
| 7 | - | - | Empty | Empty |
| 8 | Trade Date | 13/01/2026 | Sequence | Trade Date |
| 9 | Trade Time | 10:11:38 | Trade Date | Trade Time |
| 10 | Settlement Date | 13/01/2026 | Trade Time | Settlement Date |
| 11 | Settlement Time | 10:11:38 | Settlement Date | Settlement Time |
| 12 | Category | B | Settlement Time | Category Flag |

## Changes Required

### File: `src/components/eod/TradeImportDialog.tsx`

### 1. Fix Field Mapping in Parser (Lines 123-198)

**Current incorrect mapping:**
- Field 1 (index 1) treated as Investor Code
- Field 7 (index 6) treated as Trade ID Prefix

**Correct mapping based on actual file:**
- Field 0 (index 0): CSE Terminal (DHK01, DHK05, etc.)
- Field 1 (index 1): Security Code (LOVELLO, SPCERAMICS)
- Field 2 (index 2): Side (B/S)
- Field 3 (index 3): Quantity
- Field 4 (index 4): Price
- Field 5 (index 5): **Investor Code** (GZ44, NJ21, 13657)
- Field 6 (index 6): Empty or unused
- Field 7 (index 7): Empty or unused
- Field 8 (index 8): Trade Date
- Field 9 (index 9): Trade Time
- Field 10 (index 10): Settlement Date
- Field 11 (index 11): Settlement Time
- Field 12 (index 12): Category Flag

### 2. Update Variable Names

| Line | Current | New |
|------|---------|-----|
| 166 | `const tradeIdPrefix = fields[6].trim();` | `const investorCode = fields[5].trim();` |
| 131-136 | Investor code from fields[1] | Security code from fields[1] |

### 3. Regenerate Exec ID

Update the `exec_id` generation to use the correct investor code from field 5 (index 5).

### 4. Update DP Code Extraction

The DP code should be extracted from the CSE Terminal (e.g., "01" from "DHK01") and concatenated with the investor code to form the full investor code.

### 5. Update Format Documentation (Lines 514-526)

| Current | New |
|---------|-----|
| Field 2: Investor Code (14028) | Field 2: Security Code (LOVELLO) |
| Field 3: Instrument (LOVELLO) | Field 3: Side (B=Buy, S=Sell) |
| Field 4: Side (B=Buy, S=Sell) | Field 4: Quantity |
| Field 5: Quantity | Field 5: Price |
| Field 6: Price | **Field 6: Investor Code (GZ44, NJ21)** |
| Field 7: Trade ID Prefix | Field 7-8: Empty |

### 6. Update Dialog Labels

| Line | Current | New |
|------|---------|-----|
| 478 | Import DSE Trade Data | Import CSE Trade Data |
| 480 | DSE pipe-delimited | CSE pipe-delimited |
| 494 | DSE pipe-delimited | CSE pipe-delimited |
| 514 | Board+DP (DHK01, CSE05) | CSE Terminal (DHK01, DHK05) |
| 577 | Board | Terminal |

## Technical Summary

The key fix is changing the field index for investor code:
- **Before**: `fields[1]` = Investor Code, `fields[6]` = Trade ID Prefix
- **After**: `fields[5]` = Investor Code (e.g., GZ44, NJ21, 13657)

The full investor code will be constructed as: `{DP_CODE}{INVESTOR_CODE}` where DP_CODE is extracted from the terminal (e.g., "01" from "DHK01").

