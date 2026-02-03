-- Set search_path for get_negative_balance_codes function
ALTER FUNCTION public.get_negative_balance_codes(date, date, text) SET search_path = 'public';