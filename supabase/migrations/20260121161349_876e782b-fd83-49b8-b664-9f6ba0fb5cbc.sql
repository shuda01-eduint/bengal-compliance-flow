-- Create function to clear all EOD data using TRUNCATE for performance
CREATE OR REPLACE FUNCTION public.clear_all_eod_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_user_id uuid;
  v_snapshots_deleted bigint;
  v_history_deleted bigint;
BEGIN
  -- Authorization check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can clear EOD data';
  END IF;

  -- Get counts before clearing (for reporting)
  SELECT COUNT(*) INTO v_snapshots_deleted FROM eod_ledger_snapshots;
  SELECT COUNT(*) INTO v_history_deleted FROM eod_run_history;

  -- TRUNCATE is much faster than DELETE for large tables
  TRUNCATE TABLE eod_ledger_snapshots;
  TRUNCATE TABLE eod_run_history;

  RETURN jsonb_build_object(
    'success', true,
    'snapshots_deleted', v_snapshots_deleted,
    'history_deleted', v_history_deleted
  );
END;
$$;