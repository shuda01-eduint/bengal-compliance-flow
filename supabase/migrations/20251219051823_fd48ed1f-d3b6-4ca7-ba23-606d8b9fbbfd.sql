-- Drop the security definer view - it's not needed since we're using RLS policies
DROP VIEW IF EXISTS public.investors_limited;