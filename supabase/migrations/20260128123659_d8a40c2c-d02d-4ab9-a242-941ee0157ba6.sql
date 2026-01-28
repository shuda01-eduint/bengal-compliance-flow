-- Remove the obsolete 3-argument version of run_batch_eod
-- The current implementation uses only (p_eod_date, p_skip_existing)
-- This fixes the "Could not choose best candidate function" ambiguity error
DROP FUNCTION IF EXISTS public.run_batch_eod(date, uuid, boolean);