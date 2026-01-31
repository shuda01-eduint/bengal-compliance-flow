
# Fix CSE Date Display and Add DSE XML Import Support

## Summary

Two issues need to be fixed in `TradeImportDialog.tsx`:

1. **CSE Date Display Bug**: Trade dates appear as `1301-20-26` instead of `2026-01-13`
2. **No DSE XML Support**: Dialog only accepts CSE `.txt` files, rejects DSE `.xml` files

---

## Issue 1: Date Display Bug

### Root Cause Analysis

**Line 616 in TradeImportDialog.tsx:**
```typescript
{formatDateForDisplay(trade.trade_date.replace(/(\d{4})(\d{2})(\d{2})/, "$3$2$1"))}
```

**What happens:**
1. `trade.trade_date` is stored as `20260113` (YYYYMMDD format - already correct)
2. The regex captures: `$1=2026`, `$2=01`, `$3=13`
3. It reassembles as `$3$2$1` = `13012026` (no separators)
4. `formatDateForDisplay("13012026")` interprets first 4 chars as year = `1301`
5. Result: `1301-20-26` (garbage)

### Fix

Remove the regex transformation - the date is already in YYYYMMDD format which `formatDateForDisplay` handles correctly:

```typescript
// Before (line 616)
{formatDateForDisplay(trade.trade_date.replace(/(\d{4})(\d{2})(\d{2})/, "$3$2$1"))}

// After
{formatDateForDisplay(trade.trade_date)}
```

---

## Issue 2: Add DSE XML Support

### Current State

- File validation (line 261-266) only accepts `.txt`
- File input (line 497) has `accept=".txt"`
- No XML parser exists in the component

### Solution

Port the XML parsing logic from `StockExchangeUpload.tsx` (lines 575-664) which handles:
- Excel-style XML with `<Row>` and `<Cell>` elements (with `ss:Index` attributes)
- Attribute-based XML with `<Detail>` elements
- Generic XML with `<Trade>`, `<Record>`, or `<Item>` elements

---

## Technical Implementation

### 1. Add DSE XML Parser Function

Add a new function `parseDseXmlContent` that returns trades in the same `ParsedTrade` format used by the CSE parser:

```typescript
function parseDseXmlContent(
  content: string, 
  fileName: string
): { trades: ParsedTrade[]; errors: ValidationError[] } {
  const trades: ParsedTrade[] = [];
  const errors: ValidationError[] = [];
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  
  // Check for parse errors (including HTML masquerading as XML)
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    errors.push({ 
      line: 0, 
      message: "Invalid XML format - file may be HTML or corrupted" 
    });
    return { trades, errors };
  }
  
  // Parse Row/Cell format (Excel XML)
  let rows = doc.getElementsByTagName('Row');
  if (rows.length === 0) rows = doc.getElementsByTagName('row');
  
  if (rows.length > 0) {
    // Extract headers from first row
    // Parse data rows mapping to ParsedTrade interface
    // Handle ss:Index attribute for sparse cells
  } else {
    // Try Detail elements (attribute-based)
    const detailElements = doc.getElementsByTagName('Detail');
    // Map attributes to ParsedTrade
  }
  
  // Filter to only include EXEC actions with fill_type
  return { trades, errors };
}
```

### 2. Update File Validation (Lines 261-266)

```typescript
// Before
if (!selectedFile.name.toLowerCase().endsWith(".txt")) {
  toast.error("Invalid file type", {
    description: "Please upload a .txt file with CSE trade data",
  });
  return;
}

// After
const fileName = selectedFile.name.toLowerCase();
const isTxt = fileName.endsWith(".txt");
const isXml = fileName.endsWith(".xml");

if (!isTxt && !isXml) {
  toast.error("Invalid file type", {
    description: "Please upload a .txt (CSE) or .xml (DSE) trade file",
  });
  return;
}
```

### 3. Update parseFile Function (Lines 272-322)

Add file type detection and routing:

```typescript
const parseFile = async (file: File) => {
  try {
    const content = await file.text();
    const fileName = file.name.toLowerCase();
    const isXml = fileName.endsWith('.xml');

    if (isXml) {
      // DSE XML parser
      const { trades, errors } = parseDseXmlContent(content, file.name);
      setParsedTrades(trades);
      setValidationErrors(errors);
      
      if (trades.length === 0 && errors.length > 0) {
        toast.error("No valid trades found", {
          description: `${errors.length} validation errors detected`,
        });
      } else {
        toast.success(`Parsed ${trades.length} trades`, {
          description: errors.length > 0 ? `${errors.length} lines with errors` : undefined,
        });
      }
    } else {
      // Existing CSE pipe-delimited parser (unchanged)
      const lines = content.split("\n").filter((line) => line.trim());
      // ... existing logic ...
    }

    setStep("preview");
  } catch (error: any) {
    toast.error("Failed to parse file", { description: error.message });
  }
};
```

### 4. Update UI Elements

| Location | Before | After |
|----------|--------|-------|
| Dialog title (line 475) | "Import CSE Trade Data" | "Import Trade Data" |
| Description (line 477) | "Upload a .txt file with CSE pipe-delimited trade data" | "Upload a CSE (.txt) or DSE (.xml) trade file" |
| File input accept (line 497) | `.txt` | `.txt,.xml` |
| Drop zone text (line 491) | "CSE pipe-delimited .txt file" | "CSE (.txt) or DSE (.xml) trade files" |

### 5. Update Format Documentation (Lines 502-525)

Add DSE XML format alongside existing CSE format:

```
Expected DSE XML Format:
┌─────────────────────────────────────────────────────────────┐
│ Excel-style XML with Row/Cell elements:                     │
│ <Row>                                                       │
│   <Cell><Data>EXEC</Data></Cell>                           │
│   <Cell><Data>ClientCode</Data></Cell>                     │
│   ...                                                       │
│ </Row>                                                      │
├─────────────────────────────────────────────────────────────┤
│ Or Detail attributes:                                       │
│ <Detail Action="EXEC" ClientCode="12345" Side="B" ... />   │
└─────────────────────────────────────────────────────────────┘

Required fields: Action=EXEC, ClientCode, SecurityCode, Side, Quantity, Price, Date
```

---

## DSE XML Field Mapping

The XML parser will map DSE fields to the existing ParsedTrade interface:

| DSE XML Field | ParsedTrade Field | Notes |
|---------------|-------------------|-------|
| Action | (filter) | Must be "EXEC" to include |
| ClientCode | full_investor_code | Client identifier |
| SecurityCode | security_code | Stock symbol |
| Side | side | B→BUY, S→SELL |
| Quantity | quantity | Trade quantity |
| Price | price | Trade price |
| Value | value | Or calculated: qty × price |
| Date | trade_date | Convert to YYYYMMDD |
| Time | trade_time | Trade time |
| ExecID | exec_id | Unique identifier |
| FillType | (filter) | Must have value |
| Board | cse_terminal | Exchange/board |
| Category | category_flag | Trade category |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/eod/TradeImportDialog.tsx` | Fix date display, add XML parser, update validation and UI |

---

## Testing Checklist

After implementation, verify:
- [ ] CSE `.txt` files still import correctly with proper date display (YYYY-MM-DD)
- [ ] DSE `.xml` files are accepted and parsed
- [ ] Trades with empty `fill_type` are filtered out
- [ ] Preview table shows correct data for both file types
- [ ] Import to database succeeds for both formats
- [ ] Error handling works for invalid/corrupted files
