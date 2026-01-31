

# Rename Field: "board" to "CSE"

## Overview

Rename the "exchange" field to "cse" throughout the TradeImportDialog component to accurately reflect that this import is specifically for CSE (Chittagong Stock Exchange) data.

## Changes Required

### File: `src/components/eod/TradeImportDialog.tsx`

| Location | Current | New |
|----------|---------|-----|
| Line 28 (interface) | `exchange: string;` | `cse: string;` |
| Line 197 (parsed object) | `exchange,` | `cse: exchange,` |
| Line 397 (db insert) | `board: trade.exchange,` | `board: trade.cse,` |
| Line 574 (table header) | `Exchange` | `CSE` |
| Line 591 (table cell) | `{trade.exchange}` | `{trade.cse}` |
| Lines 510-511 (help text) | References to "Exchange (DHK/CSE)" | "CSE Terminal" |

### Summary of Changes

1. **Interface Update**: Rename `exchange` property to `cse` in `ParsedTrade` interface
2. **Parser Update**: Map the extracted exchange value to the new `cse` field
3. **Database Insert**: Update `board: trade.exchange` to `board: trade.cse`
4. **Table Header**: Change "Exchange" column header to "CSE"
5. **Table Cell**: Update display from `trade.exchange` to `trade.cse`
6. **Help Text**: Update format documentation to reference "CSE" instead of "Exchange"

