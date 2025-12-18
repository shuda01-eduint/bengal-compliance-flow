-- Add unique constraint to prevent duplicate trade imports
-- This ensures each exec_id can only exist once per trade_date
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_history_exec_id_trade_date_unique 
ON trade_history (exec_id, trade_date) 
WHERE exec_id IS NOT NULL;