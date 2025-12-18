-- Add unique constraint for upsert operations on trade_history
ALTER TABLE public.trade_history 
ADD CONSTRAINT trade_history_exec_id_trade_date_key 
UNIQUE (exec_id, trade_date);