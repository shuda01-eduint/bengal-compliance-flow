-- Function to initialize the copy process (validates, clears target, returns count)
CREATE OR REPLACE FUNCTION public.init_copy_balances(p_source_date date, p_target_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  source_count integer;
  deleted_count integer;
BEGIN
  -- Only allow admins
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  -- Validate dates
  IF p_source_date IS NULL OR p_target_date IS NULL THEN
    RAISE EXCEPTION 'Source and target dates are required';
  END IF;
  
  IF p_source_date = p_target_date THEN
    RAISE EXCEPTION 'Source and target dates must be different';
  END IF;
  
  -- Get source count
  SELECT COUNT(*) INTO source_count FROM balances_raw WHERE as_of_date = p_source_date;
  
  IF source_count = 0 THEN
    RAISE EXCEPTION 'No balance data found for source date %', p_source_date;
  END IF;
  
  -- Delete existing data for target date
  DELETE FROM balances_raw WHERE as_of_date = p_target_date;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'total_rows', source_count,
    'deleted_count', deleted_count
  );
END;
$function$;

-- Function to copy a batch of records
CREATE OR REPLACE FUNCTION public.copy_balances_batch(
  p_source_date date,
  p_target_date date,
  p_batch_size integer DEFAULT 5000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  copied_count integer;
BEGIN
  -- Only allow admins
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  -- Copy batch of data
  INSERT INTO balances_raw (
    as_of_date,
    investor_code,
    instrument,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    total_mv,
    ledger_balance,
    matured_balance,
    receivable_sale,
    cq_in_transit,
    rm_name,
    rm_id,
    rm_email
  )
  SELECT 
    p_target_date,
    investor_code,
    instrument,
    total_stock,
    saleable,
    avg_cost,
    total_cost,
    total_mv,
    ledger_balance,
    matured_balance,
    receivable_sale,
    cq_in_transit,
    rm_name,
    rm_id,
    rm_email
  FROM balances_raw
  WHERE as_of_date = p_source_date
  ORDER BY id
  LIMIT p_batch_size
  OFFSET p_offset;
  
  GET DIAGNOSTICS copied_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'copied_count', copied_count,
    'offset', p_offset,
    'has_more', copied_count = p_batch_size
  );
END;
$function$;