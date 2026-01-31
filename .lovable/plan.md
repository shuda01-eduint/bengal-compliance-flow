

# Create New EOD Processing Tables & Update Import Functions

## Overview

This plan creates the new staging/processing tables from your SQL schema and updates the import dialogs to use them instead of the current tables. We'll handle the schema conflicts carefully to preserve your existing 32,099 investors and 299 employees.

---

## Phase 1: Database Migration

### Tables to Create (New)

These tables don't exist and will be created:

| Table | Purpose |
|-------|---------|
| `trade_file` | Trade staging table for import |
| `cash_ledger_txn` | Deposits/withdrawals with transaction types |
| `cheque_in_hand` | Pending cheques tracking |
| `instrument_prices_eod` | Daily closing prices |
| `eod_instrument_position` | EOD holdings per investor/instrument |
| `eod_investor_balance` | EOD balance summary per investor |
| `investor_charge_config` | Commission/interest rates with effective dates |
| `investor_change_logs` | Audit trail for investor changes |

### Tables to Skip (Already Exist)

- `employees` - Already exists with 299 records and different schema
- `investors` - Already exists with 32,099 records and different schema

### Modified SQL (Removing Duplicates & Conflicts)

```sql
-- Trade staging table
CREATE TABLE public.trade_file (
  trade_id bigserial PRIMARY KEY,
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  instrument text NOT NULL,
  side text CHECK (side IN ('BUY','SELL')),
  qty numeric(18,4) NOT NULL,
  price numeric(18,6) NOT NULL,
  settlement_date date NOT NULL,
  commission numeric(18,6) DEFAULT 0,
  category text,
  fill_type text,
  exchange_code text,
  created_at timestamptz DEFAULT now()
);

-- Cash ledger transactions
CREATE TABLE public.cash_ledger_txn (
  txn_id bigserial PRIMARY KEY,
  txn_date date NOT NULL,
  investor_code text NOT NULL,
  type text CHECK (type IN ('DEPOSIT','WITHDRAW','TRADE_CASH','COMMISSION','INTEREST','OTHER')),
  amount numeric(18,2) NOT NULL,
  description text,
  reference text,
  created_at timestamptz DEFAULT now()
);

-- Cheque tracking
CREATE TABLE public.cheque_in_hand (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  amount numeric(18,2) NOT NULL,
  cheque_date date NOT NULL,
  status text CHECK (status IN ('PENDING','CLEARED','BOUNCED')) DEFAULT 'PENDING',
  created_at timestamptz DEFAULT now()
);

-- Daily instrument prices
CREATE TABLE public.instrument_prices_eod (
  trade_date date NOT NULL,
  instrument text NOT NULL,
  eod_price numeric(18,6) NOT NULL,
  PRIMARY KEY (trade_date, instrument)
);

-- EOD instrument positions
CREATE TABLE public.eod_instrument_position (
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  instrument text NOT NULL,
  total_stock numeric(18,4) NOT NULL,
  saleable numeric(18,4) NOT NULL,
  avg_cost numeric(18,6) NOT NULL,
  total_cost numeric(18,2) NOT NULL,
  total_market_value numeric(18,2) NOT NULL,
  PRIMARY KEY (trade_date, investor_code, instrument)
);

-- EOD investor balance summary
CREATE TABLE public.eod_investor_balance (
  trade_date date NOT NULL,
  investor_code text NOT NULL,
  boid text,
  rm_id text,
  opening_ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  matured_balance numeric(18,2) NOT NULL DEFAULT 0,
  receivable_sales numeric(18,2) NOT NULL DEFAULT 0,
  cheque_in_tran_hand numeric(18,2) NOT NULL DEFAULT 0,
  accrued_int numeric(18,2) NOT NULL DEFAULT 0,
  closing_ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  equity numeric(18,2) NOT NULL DEFAULT 0,
  d_e_rate numeric(18,6),
  PRIMARY KEY (trade_date, investor_code)
);

-- Investor charge configuration
CREATE TABLE public.investor_charge_config (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  commission_rate numeric(10,4) NOT NULL,
  charge_rate numeric(10,4) NOT NULL,
  d_e_limit numeric(18,6),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz DEFAULT now()
);

-- Investor change audit log
CREATE TABLE public.investor_change_logs (
  id bigserial PRIMARY KEY,
  investor_code text NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by text NOT NULL,
  changed_at timestamptz DEFAULT now(),
  approval_status text DEFAULT 'PENDING',
  approved_by text,
  approved_at timestamptz
);

-- Create indexes for performance
CREATE INDEX idx_trade_file_date ON public.trade_file(trade_date);
CREATE INDEX idx_trade_file_investor ON public.trade_file(investor_code);
CREATE INDEX idx_cash_ledger_date ON public.cash_ledger_txn(txn_date);
CREATE INDEX idx_cash_ledger_investor ON public.cash_ledger_txn(investor_code);
CREATE INDEX idx_eod_investor_balance_date ON public.eod_investor_balance(trade_date);
CREATE INDEX idx_eod_instrument_position_date ON public.eod_instrument_position(trade_date);
```

### RLS Policies

Enable RLS and create admin policies for all new tables:

```sql
-- Enable RLS
ALTER TABLE public.trade_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_ledger_txn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_in_hand ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_prices_eod ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_instrument_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eod_investor_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_charge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_change_logs ENABLE ROW LEVEL SECURITY;

-- Admin policies (manage all)
CREATE POLICY "Admins manage trade_file" ON public.trade_file FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage cash_ledger_txn" ON public.cash_ledger_txn FOR ALL USING (has_role(auth.uid(), 'admin'));
-- ... (similar for all tables)

-- Approved users view policies
CREATE POLICY "Approved users view trade_file" ON public.trade_file FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_approved = true));
-- ... (similar for all tables)
```

---

## Phase 2: Update Import Functions

### 1. TradeImportDialog.tsx

**Current:** Imports to `trade_history` table
**Change to:** Import to `trade_file` table

**Field Mapping:**

| Current Field | New Field |
|--------------|-----------|
| `client_code` | `investor_code` |
| `security_code` | `instrument` |
| `trade_date` (text YYYYMMDD) | `trade_date` (date) |
| `side` | `side` |
| `quantity` | `qty` |
| `price` | `price` |
| `value` | (calculated) |
| `category` | `category` |
| `fill_type` | `fill_type` |
| `board` | `exchange_code` |
| *(new)* | `settlement_date` (T+2) |
| *(new)* | `commission` |

**Changes:**
- Convert `trade_date` from YYYYMMDD text to DATE type
- Calculate `settlement_date` as T+2
- Store `exchange_code` (CSE01, DSE, etc.)
- Remove denormalized fields (rm_name, department, etc.)

### 2. DepositsImportDialog.tsx

**Current:** Imports to `deposits_withdrawals` table
**Change to:** Import to `cash_ledger_txn` table

**Field Mapping:**

| Current Field | New Field |
|--------------|-----------|
| `investor_code` | `investor_code` |
| `transaction_date` | `txn_date` |
| `transaction_type` (Deposit/Withdrawal) | `type` (DEPOSIT/WITHDRAW) |
| `amount` | `amount` |
| `remarks` | `description` |

**Changes:**
- Normalize transaction_type to uppercase enum values
- Use `txn_date` instead of `transaction_date`
- Use `description` instead of `remarks`

### 3. ImportAdminBalanceDialog.tsx

**Current:** Imports to `eod_ledger_snapshots` table
**Change to:** Import to `eod_investor_balance` table

**Field Mapping:**

| Current Field | New Field |
|--------------|-----------|
| `eod_date` | `trade_date` |
| `investor_code` | `investor_code` |
| `ledger_balance` | `closing_ledger_balance` |
| *(new)* | `boid` |
| *(new)* | `rm_id` |
| *(new)* | `opening_ledger_balance` |
| *(new)* | `matured_balance` |
| *(new)* | `receivable_sales` |
| *(new)* | `cheque_in_tran_hand` |
| *(new)* | `accrued_int` |
| *(new)* | `equity` |
| *(new)* | `d_e_rate` |

**Changes:**
- Update column mappings for additional balance fields
- Parse matured_balance, receivable_sales, etc. from Excel
- Use composite primary key (trade_date, investor_code) for upsert

---

## Phase 3: Files to Modify

| File | Changes |
|------|---------|
| `src/components/eod/TradeImportDialog.tsx` | Change target table to `trade_file`, update field mapping, add settlement_date calculation |
| `src/components/eod/DepositsImportDialog.tsx` | Change target table to `cash_ledger_txn`, update field names |
| `src/components/admin/ImportAdminBalanceDialog.tsx` | Change target table to `eod_investor_balance`, add new balance fields |
| `src/lib/validation-schemas.ts` | Update or add new validation schemas for the new table structures |

---

## Technical Details

### Trade Date Conversion
```typescript
// Convert YYYYMMDD to DATE
function formatTradeDate(yyyymmdd: string): string {
  // "20260115" -> "2026-01-15"
  const year = yyyymmdd.substring(0, 4);
  const month = yyyymmdd.substring(4, 6);
  const day = yyyymmdd.substring(6, 8);
  return `${year}-${month}-${day}`;
}
```

### Settlement Date Calculation (T+2)
```typescript
function calculateSettlementDate(tradeDate: Date): Date {
  let settlement = new Date(tradeDate);
  let businessDays = 0;
  while (businessDays < 2) {
    settlement.setDate(settlement.getDate() + 1);
    // Skip weekends (Saturday=6, Sunday=0)
    if (settlement.getDay() !== 0 && settlement.getDay() !== 6) {
      businessDays++;
    }
  }
  return settlement;
}
```

### Transaction Type Normalization
```typescript
function normalizeTransactionType(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('deposit') || lower.includes('receipt')) return 'DEPOSIT';
  if (lower.includes('withdraw') || lower.includes('payment')) return 'WITHDRAW';
  return 'OTHER';
}
```

---

## Implementation Order

1. **Create database tables** via migration tool
2. **Update TradeImportDialog** to use `trade_file`
3. **Update DepositsImportDialog** to use `cash_ledger_txn`
4. **Update ImportAdminBalanceDialog** to use `eod_investor_balance`
5. **Test imports** with sample data

---

## Questions Before Implementation

Before I proceed, I'd like to confirm:

1. **Foreign Keys**: Your SQL had `REFERENCES public.investors(investor_code)` - but the existing `investors` table uses `investor_code` as a text column (not primary key). Should I skip these foreign key constraints to avoid conflicts?

2. **Existing Data**: Do you want to keep the existing tables (`trade_history`, `deposits_withdrawals`, `eod_ledger_snapshots`) for historical data, or should I migrate data from them to the new tables?

3. **EOD Processing Functions**: You mentioned `process_staged_trades`, `calculate_settlement_date`, `process_settlements` functions - should I create these as part of this plan, or do you have SQL for them?

