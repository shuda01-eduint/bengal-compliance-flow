-- Remove the old overloaded functions that are causing PGRST203 ambiguity errors
-- These have DATE/boolean parameters while the UI sends TEXT/TEXT

DROP FUNCTION IF EXISTS public.get_accounting_data(
  text, date, date, date, date, integer, integer, text, boolean, text, text
);

DROP FUNCTION IF EXISTS public.get_accounting_summary(
  text, date, date, date, date, text, boolean
);