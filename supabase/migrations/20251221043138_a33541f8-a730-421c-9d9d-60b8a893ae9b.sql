-- Drop the get_accounting_data function with DATE type parameters causing overload
-- This exact signature has _from_tx_date and _to_tx_date as DATE instead of TEXT
DROP FUNCTION IF EXISTS public.get_accounting_data(
  text,   -- _search_term
  text,   -- _from_trade_date  
  text,   -- _to_trade_date
  date,   -- _from_tx_date (DATE type causing conflict)
  date,   -- _to_tx_date (DATE type causing conflict)
  integer,-- _page_size
  integer,-- _page_offset
  text,   -- _account_type_filter
  text    -- _has_trades_filter
);