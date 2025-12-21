-- Drop old get_accounting_data with DATE parameters (the one causing overload)
DROP FUNCTION IF EXISTS public.get_accounting_data(text, text, date, date, integer, integer, text, text);

-- Drop old get_accounting_summary with DATE parameters (the one causing overload)
DROP FUNCTION IF EXISTS public.get_accounting_summary(text, text, date, date, text, text);