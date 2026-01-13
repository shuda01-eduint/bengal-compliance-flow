-- Drop the duplicate text-parameter version of run_batch_eod
-- This resolves the PGRST203 error caused by ambiguous function overloading
DROP FUNCTION IF EXISTS public.run_batch_eod(text, text);