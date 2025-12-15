-- Add indexes for fast trade history queries and calculations
CREATE INDEX IF NOT EXISTS idx_trade_history_client_code ON trade_history(client_code);
CREATE INDEX IF NOT EXISTS idx_trade_history_uploaded_at ON trade_history(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_trade_history_trade_date ON trade_history(trade_date);
CREATE INDEX IF NOT EXISTS idx_trade_history_side ON trade_history(side);
CREATE INDEX IF NOT EXISTS idx_trade_history_security_code ON trade_history(security_code);
CREATE INDEX IF NOT EXISTS idx_trade_history_composite ON trade_history(side, file_name, trade_date);
CREATE INDEX IF NOT EXISTS idx_trade_history_client_date ON trade_history(client_code, trade_date);