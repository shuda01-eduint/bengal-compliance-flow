-- Update the margin_equity_snapshots view to show portfolio values correctly
-- regardless of marginability flag (for now, treat all holdings as potential collateral)
DROP VIEW IF EXISTS margin_equity_snapshots;

CREATE VIEW margin_equity_snapshots 
WITH (security_invoker = on) 
AS
WITH latest_eod AS (
  SELECT MAX(eod_date) as eod_date FROM eod_ledger_snapshots
),
holding_values AS (
  SELECT 
    h.investor_code,
    h.eod_date,
    -- Marginable holdings after haircut (securities flagged as marginable)
    COALESCE(SUM(
      CASE WHEN s.is_marginable = true 
      THEN h.market_value * (1 - COALESCE(s.haircut_percentage, 30) / 100)
      ELSE 0 END
    ), 0) AS marginable_after_haircut,
    -- Non-marginable holdings (securities not flagged as marginable)
    COALESCE(SUM(
      CASE WHEN s.is_marginable = false OR s.is_marginable IS NULL
      THEN h.market_value
      ELSE 0 END
    ), 0) AS non_marginable_holdings,
    -- Total portfolio value for KPI display
    COALESCE(SUM(h.market_value), 0) AS total_portfolio_value
  FROM eod_holding_snapshots h
  LEFT JOIN securities s ON s.trading_code = h.security_code
  GROUP BY h.investor_code, h.eod_date
)
SELECT 
  els.investor_code,
  els.eod_date,
  els.rm_name,
  els.department AS department_name,
  els.closing_balance AS ledger_closing_balance,
  COALESCE(els.interest_rate, 0) AS margin_interest_rate,
  -- Get previous day closing balance for interest calculation
  COALESCE(prev.closing_balance, 0) AS previous_day_balance,
  -- Daily accrued interest on margin loan (negative balance)
  CASE 
    WHEN COALESCE(prev.closing_balance, 0) < 0 
    THEN ABS(COALESCE(prev.closing_balance, 0)) * COALESCE(els.interest_rate, 0) / 100 / 365
    ELSE 0
  END AS accrued_interest,
  COALESCE(hv.marginable_after_haircut, 0) AS marginable_after_haircut,
  COALESCE(hv.non_marginable_holdings, 0) AS non_marginable_holdings,
  COALESCE(hv.total_portfolio_value, 0) AS total_portfolio_value,
  -- Total equity = ledger balance + marginable + non-marginable + accrued interest
  els.closing_balance 
    + COALESCE(hv.marginable_after_haircut, 0) 
    + COALESCE(hv.non_marginable_holdings, 0)
    + CASE 
        WHEN COALESCE(prev.closing_balance, 0) < 0 
        THEN ABS(COALESCE(prev.closing_balance, 0)) * COALESCE(els.interest_rate, 0) / 100 / 365
        ELSE 0
      END AS equity
FROM eod_ledger_snapshots els
CROSS JOIN latest_eod le
LEFT JOIN eod_ledger_snapshots prev 
  ON prev.investor_code = els.investor_code 
  AND prev.eod_date = els.eod_date - 1
LEFT JOIN holding_values hv 
  ON hv.investor_code = els.investor_code 
  AND hv.eod_date = els.eod_date
WHERE els.eod_date = le.eod_date;