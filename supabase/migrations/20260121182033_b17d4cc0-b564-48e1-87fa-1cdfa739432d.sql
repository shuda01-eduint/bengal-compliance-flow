-- Create function to clear EOD data for a specific date range
CREATE OR REPLACE FUNCTION clear_eod_by_date_range(
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snapshots_deleted integer;
  history_deleted integer;
  v_user_role text;
BEGIN
  -- Check admin role
  SELECT role INTO v_user_role FROM profiles WHERE id = auth.uid();
  IF v_user_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only administrators can clear EOD data';
  END IF;

  -- Validate inputs
  IF p_from_date IS NULL OR p_to_date IS NULL THEN
    RAISE EXCEPTION 'Both from_date and to_date are required';
  END IF;

  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'from_date cannot be after to_date';
  END IF;

  -- Delete snapshots in date range
  DELETE FROM eod_ledger_snapshots 
  WHERE eod_date >= p_from_date AND eod_date <= p_to_date;
  GET DIAGNOSTICS snapshots_deleted = ROW_COUNT;

  -- Delete run history in date range
  DELETE FROM eod_run_history 
  WHERE run_date >= p_from_date AND run_date <= p_to_date;
  GET DIAGNOSTICS history_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'snapshots_deleted', snapshots_deleted,
    'history_deleted', history_deleted
  );
END;
$$;