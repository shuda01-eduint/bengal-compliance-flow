-- Drop the existing unique constraint on (exec_id, trade_date)
ALTER TABLE public.trade_history 
DROP CONSTRAINT IF EXISTS trade_history_exec_id_trade_date_key;

-- Create a new unique constraint that includes client_code and board
ALTER TABLE public.trade_history 
ADD CONSTRAINT trade_history_unique_trade 
UNIQUE (exec_id, trade_date, client_code, board);