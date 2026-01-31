

# Fix CSE Trade Parser: Field Indices Off By One

## Root Cause Analysis

Looking at the actual uploaded file `BT_WITH_TRADE_FLAG-4.txt`:

```
DHK01|14028|LOVELLO|S|35000|65.00|GZ44|||22|13/01/2026|10:11:38|13/01/2026|10:11:38|B
```

The file has **15 pipe-delimited fields** (indices 0-14), but the parser is written for **13 fields** (indices 0-12). This causes all field mappings after index 0 to be off by one position.

### Actual Field Structure

| Index | Actual Content | Parser Expects | Result |
|-------|---------------|----------------|--------|
| 0 | DHK01 (Terminal) | Terminal | Correct |
| 1 | **14028** (Unknown ID) | Security Code | **WRONG** |
| 2 | LOVELLO (Security) | Side | **WRONG** - parsed as side causes "Invalid side" |
| 3 | S (Side) | Quantity | **WRONG** - parseInt("S") = NaN |
| 4 | 35000 (Qty) | Price | **WRONG** |
| 5 | 65.00 (Price) | Investor Code | **WRONG** |
| 6 | GZ44 (Investor) | Empty | **WRONG** |
| ... | ... | ... | ... |

### Why 12 Validation Errors Occur

Every line fails validation because:
- `fields[2]` (LOVELLO) is tested as Side ("B" or "S") → Fails validation
- `fields[3]` ("S") is parsed as quantity → `parseInt("S")` = NaN → Invalid quantity
- The cascade of wrong field positions causes parse failures

## Solution

Update the parser to use the correct field indices based on the actual 15-field CSE format:

| Index | Field | Example |
|-------|-------|---------|
| 0 | CSE Terminal | DHK01 |
| 1 | Unknown ID (ignore) | 14028 |
| 2 | Security Code | LOVELLO |
| 3 | Side (B/S) | S |
| 4 | Quantity | 35000 |
| 5 | Price | 65.00 |
| 6 | Investor Code | GZ44 |
| 7-8 | Empty | (unused) |
| 9 | Trade Sequence | 22 |
| 10 | Trade Date | 13/01/2026 |
| 11 | Trade Time | 10:11:38 |
| 12 | Settlement Date | 13/01/2026 |
| 13 | Settlement Time | 10:11:38 |
| 14 | Category Flag | B |

## Changes Required

### File: `src/components/eod/TradeImportDialog.tsx`

### 1. Update Minimum Field Count Validation (Line 119-120)

Change from:
```typescript
if (fields.length < 9) {
  return { line: lineNumber, message: `Expected at least 9 pipe-delimited fields, got ${fields.length}` ...
```

To:
```typescript
if (fields.length < 11) {
  return { line: lineNumber, message: `Expected at least 11 pipe-delimited fields, got ${fields.length}` ...
```

### 2. Fix Field Index Mappings (Lines 131-190)

| Current Index | New Index | Field |
|---------------|-----------|-------|
| `fields[1]` | `fields[2]` | Security Code |
| `fields[2]` | `fields[3]` | Side |
| `fields[3]` | `fields[4]` | Quantity |
| `fields[4]` | `fields[5]` | Price |
| `fields[5]` | `fields[6]` | Investor Code |
| `fields[8]` | `fields[10]` | Trade Date |
| `fields[9]` | `fields[11]` | Trade Time |
| `fields[10]` | `fields[12]` | Settlement Date |
| `fields[11]` | `fields[13]` | Settlement Time |
| `fields[12]` | `fields[14]` | Category Flag |

### 3. Update exec_id to Include Trade Sequence (Line 181)

Include the trade sequence number (index 9) in the exec_id for better uniqueness:
```typescript
const tradeSequence = fields[9]?.trim() || "";
const execId = `CSE_${cseTerminal}_${fullInvestorCode}_${securityCode}_${tradeDateFormatted}_${side}_${quantity}_${price}_${tradeSequence}`;
```

### 4. Update Format Documentation (Lines 501-516)

Update the example and field descriptions to match the actual 15-field format:
```
DHK01|14028|LOVELLO|S|35000|65.00|GZ44|||22|13/01/2026|10:11:38|13/01/2026|10:11:38|B
```

Field descriptions:
- Field 1: CSE Terminal (DHK01, DHK05)
- Field 2: Unknown ID (ignored)
- Field 3: Security Code (LOVELLO)
- Field 4: Side (B=Buy, S=Sell)
- Field 5: Quantity (35000)
- Field 6: Price (65.00)
- Field 7: Investor Code (GZ44, NJ21)
- Field 8-9: Empty
- Field 10: Trade Sequence (22)
- Field 11: Trade Date (DD/MM/YYYY)
- Field 12: Trade Time (HH:MM:SS)
- Field 13-14: Settlement Date/Time
- Field 15: Category (B/N)

## Technical Summary

The core issue is that the actual CSE file has an additional field at index 1 (a numeric ID like "14028") that the current parser doesn't account for. All subsequent field indices need to be shifted by +1.

### Before (Wrong)
```typescript
const securityCode = fields[1].trim(); // Gets "14028" instead of "LOVELLO"
const sideChar = fields[2].trim();     // Gets "LOVELLO" instead of "S"
```

### After (Correct)
```typescript
const securityCode = fields[2].trim(); // Gets "LOVELLO"
const sideChar = fields[3].trim();     // Gets "S"
```

