-- Drop the OLD text-based function that's causing conflicts
DROP FUNCTION IF EXISTS public.get_accounting_data_v3(text, text, text, text, text, integer, integer);