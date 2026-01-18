-- Drop the DATE parameter version to eliminate ambiguity
-- Keep only the TEXT version which the frontend uses
DROP FUNCTION IF EXISTS public.run_batch_eod(date, date);