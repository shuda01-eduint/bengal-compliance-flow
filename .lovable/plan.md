

# Enhanced EOD Processing with Accrued Interest and Equity

## Overview

Expand the `process_staged_trades` function to include:
1. **Daily Accrued Interest** - Calculated for margin accounts (negative balance)
2. **Cumulative Interest** - Running total of accrued interest
3. **Equity Calculation** - Portfolio value minus loan minus accrued interest

---

## Current Data Analysis

### Margin Account Statistics (Jan 12 Baseline)

| Metric | Value |
|--------|-------|
| Total Investors | 23,677 |
| Margin Investors (negative balance) | 5,229 |
| Total Margin Exposure | 7.07B BDT |
| Investors with Interest Rate > 0 | 1,379 |
| Interest Rate Range | 0% - 20.85% |
| Average Interest Rate | 0.79% (overall), ~18% (margin accounts) |

### Sample Daily Interest Calculation

| Investor | Balance | Rate | Daily Interest |
|----------|---------|------|----------------|
| MR. MAKSUDUR RAHMAN | -673.6M | 17.85% | 329,443 BDT |
| ARCOM ASSET MANAGEMENT | -436.9M | 18.75% | 224,458 BDT |
| DESH IDEAL TRUST | -292.5M | 19.35% | 155,078 BDT |
| Shakib Al Hasan | -286.5M | 19.35% | 151,879 BDT |
| MD. ABUL HASEM RAIHAN | -270.2M | 16.50% | 122,140 BDT |

---

## Calculation Formulas

### Daily Accrued Interest

```text
daily_interest = (interest_rate / 365 / 100) × ABS(closing_balance)
```

Only calculated when:
- `closing_balance < 0` (investor owes broker)
- `interest_rate > 0` (from investors table)

### Cumulative Interest

```text
cumulative_interest = previous_cumulative_interest + daily_interest
```

For first EOD run, cumulative interest starts at 0 (or from baseline if provided).

### Equity Calculation

```text
equity = portfolio_value - ABS(ledger_balance) - cumulative_interest
```

Where:
- `portfolio_value` = total market value of holdings
- `ABS(ledger_balance)` = loan amount (for negative balances)
- `cumulative_interest` = total interest accrued to date

---

## Implementation Details

### Enhanced Data Flow

```text
balances_raw (Jan 12)           investors table
├─ investor_code                 ├─ investor_code
├─ ledger_balance               ├─ interest_rate ─────┐
├─ total_mv (portfolio)         ├─ account_type       │
└─ matured_balance              └─ brokerage_commission│
         │                                            │
         ▼                                            │
┌─────────────────────────────────────────────────────┴─────┐
│            process_staged_trades(Jan 13)                  │
│                                                           │
│  Calculations:                                            │
│  ├─ closing_balance = opening + deposits - withdrawals    │
│  │                    + sells - buys - commission         │
│  │                                                        │
│  ├─ daily_interest = (rate/365/100) × ABS(closing)       │
│  │                   (only if closing < 0)                │
│  │                                                        │
│  ├─ cumulative_interest = prev_cumulative + daily         │
│  │                                                        │
│  └─ equity = portfolio_value - ABS(closing) - cumulative  │
└───────────────────────────────────────────────────────────┘
         │
         ▼
eod_ledger_snapshots
├─ closing_balance
├─ accrued_interest (daily)
├─ cumulative_interest (running total)
├─ total_mv (portfolio value)
├─ interest_rate
└─ [equity calculated on read or stored]
```

### SQL Logic for Interest and Equity

```sql
-- Get interest rate from investors table
WITH investor_config AS (
  SELECT investor_code, interest_rate, account_type, brokerage_commission
  FROM investors
),

-- Calculate closing balance first
balances AS (
  SELECT
    investor_code,
    opening_balance + deposits - withdrawals + gross_sell - gross_buy - commission as closing_balance,
    total_mv as portfolio_value
  FROM computed_values
),

-- Calculate daily interest (only for negative balances)
interest_calc AS (
  SELECT
    b.investor_code,
    b.closing_balance,
    b.portfolio_value,
    CASE 
      WHEN b.closing_balance < 0 AND ic.interest_rate > 0 THEN
        ROUND((ic.interest_rate / 365 / 100) * ABS(b.closing_balance), 2)
      ELSE 0
    END as daily_interest,
    -- Get previous cumulative from last snapshot or baseline (0 for first run)
    COALESCE(prev.cumulative_interest, 0) as prev_cumulative,
    ic.interest_rate
  FROM balances b
  LEFT JOIN investor_config ic ON b.investor_code = ic.investor_code
  LEFT JOIN eod_ledger_snapshots prev 
    ON b.investor_code = prev.investor_code 
    AND prev.eod_date = p_trade_date - 1
),

-- Final calculation with equity
final_calc AS (
  SELECT
    investor_code,
    closing_balance,
    portfolio_value,
    daily_interest as accrued_interest,
    prev_cumulative + daily_interest as cumulative_interest,
    interest_rate,
    -- Equity calculation
    portfolio_value - ABS(LEAST(closing_balance, 0)) - (prev_cumulative + daily_interest) as equity
  FROM interest_calc
)
```

---

## Existing Schema Alignment

The `eod_ledger_snapshots` table already has all required columns:

| Column | Type | Purpose |
|--------|------|---------|
| `accrued_interest` | numeric | Daily interest for this EOD date |
| `cumulative_interest` | numeric | Running total of interest |
| `interest_rate` | numeric | Rate used for calculation |
| `total_mv` | numeric | Portfolio market value |
| `account_type` | text | Margin/Cash classification |

Note: Equity is currently calculated on-the-fly in frontend rather than stored. We can either:
1. Calculate and store equity in snapshots
2. Continue calculating in frontend using: `equity = total_mv - ABS(closing_balance) - cumulative_interest`

---

## Enhanced Return Object

```json
{
  "success": true,
  "trade_date": "2026-01-13",
  
  "trade_count": 23749,
  "investor_count": 23677,
  "gross_buy": 488000000,
  "gross_sell": 489000000,
  "total_commission": 1200000,
  
  "deposit_count": 200,
  "withdrawal_count": 217,
  "total_deposits": 37400000,
  "total_withdrawals": 137000000,
  
  "instruments_priced": 542,
  "positions_captured": 75000,
  "total_market_value": 59000000000,
  
  "margin_accounts": 5229,
  "margin_exposure": 7065000000,
  "daily_interest_total": 3450000,
  "cumulative_interest_total": 3450000,
  
  "total_equity": 52000000000,
  "negative_equity_count": 12
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| Database Migration | Create | `process_staged_trades` function with interest and equity |
| Database Migration | Create | `calculate_settlements` function |
| `src/pages/EodPage.tsx` | Modify | Add RPC calls and display interest/equity metrics |
| `src/components/eod/EodSummaryCards.tsx` | Modify | Add cards for interest and equity totals |

---

## Edge Cases Handled

1. **First EOD Run**: Cumulative interest starts at 0 (no previous snapshot)
2. **Cash Accounts**: interest_rate = 0, so daily_interest = 0
3. **Positive Balance**: No interest charged (closing_balance >= 0)
4. **Missing Interest Rate**: Default to 0 from investors table
5. **Negative Equity**: Flag accounts where equity < 0 for margin call review

---

## Testing Checklist

After implementation:
- [ ] Process staged trades for 2026-01-13
- [ ] Verify daily_interest calculated for 5,229 margin accounts
- [ ] Check total daily interest is ~3.4M BDT (based on sample calculation)
- [ ] Verify cumulative_interest = daily_interest for first run
- [ ] Check equity = total_mv - ABS(closing) - cumulative
- [ ] Identify any accounts with negative equity
- [ ] Run for subsequent days and verify cumulative interest accumulates

