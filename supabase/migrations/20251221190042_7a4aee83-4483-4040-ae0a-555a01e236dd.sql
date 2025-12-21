-- Drop the text parameter version to resolve function overloading conflict
DROP FUNCTION IF EXISTS public.get_accounting_turnover_by_department(text, text);