-- Update clear_eod_by_date_range to also clear staging tables (trade_file, cash_ledger_txn)
CREATE OR REPLACE FUNCTION public.clear_eod_by_date_range(
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshots_deleted integer := 0;
  v_history_deleted integer := 0;
  v_positions_deleted integer := 0;
  v_trades_deleted integer := 0;
  v_cash_txn_deleted integer := 0;
BEGIN
  -- Delete EOD ledger snapshots
  DELETE FROM eod_ledger_snapshots
  WHERE eod_date >= p_from_date AND eod_date <= p_to_date;
  GET DIAGNOSTICS v_snapshots_deleted = ROW_COUNT;

  -- Delete EOD run history
  DELETE FROM eod_run_history
  WHERE run_date >= p_from_date AND run_date <= p_to_date;
  GET DIAGNOSTICS v_history_deleted = ROW_COUNT;

  -- Delete EOD instrument positions
  DELETE FROM eod_instrument_position
  WHERE trade_date >= p_from_date AND trade_date <= p_to_date;
  GET DIAGNOSTICS v_positions_deleted = ROW_COUNT;

  -- Delete staging trades for the date range
  DELETE FROM trade_file
  WHERE trade_date >= p_from_date AND trade_date <= p_to_date;
  GET DIAGNOSTICS v_trades_deleted = ROW_COUNT;

  -- Delete staging cash transactions for the date range
  DELETE FROM cash_ledger_txn
  WHERE txn_date >= p_from_date AND txn_date <= p_to_date;
  GET DIAGNOSTICS v_cash_txn_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'snapshots_deleted', v_snapshots_deleted,
    'history_deleted', v_history_deleted,
    'positions_deleted', v_positions_deleted,
    'trades_deleted', v_trades_deleted,
    'cash_txn_deleted', v_cash_txn_deleted
  );
END;
$$;