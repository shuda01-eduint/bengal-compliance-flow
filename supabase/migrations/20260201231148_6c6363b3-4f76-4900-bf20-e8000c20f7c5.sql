-- Fix search_path for process_staged_trades function
ALTER FUNCTION public.process_staged_trades(date) SET search_path = public;