-- Add ledger_balance column to investors table for baseline balance storage
ALTER TABLE investors 
ADD COLUMN IF NOT EXISTS ledger_balance NUMERIC DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN investors.ledger_balance IS 'Baseline ledger balance (Jan 12, 2026) - used as fallback for EOD chain initialization';