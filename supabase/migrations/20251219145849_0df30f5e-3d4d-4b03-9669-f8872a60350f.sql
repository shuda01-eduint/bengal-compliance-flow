CREATE OR REPLACE FUNCTION public.copy_balances_to_date(p_source_date date, p_target_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count integer;
  inserted_count integer;
BEGIN
  -- Set longer timeout for bulk operation (2 minutes)
  SET LOCAL statement_timeout = '120s';
  
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
  
  -- Check source date has data
  IF NOT EXISTS (SELECT 1 FROM balances_raw WHERE as_of_date = p_source_date LIMIT 1) THEN
    RAISE EXCEPTION 'No balance data found for source date %', p_source_date;
  END IF;
  
  -- Delete existing data for target date
  DELETE FROM balances_raw WHERE as_of_date = p_target_date;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Copy data from source to target date
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
  WHERE as_of_date = p_source_date;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'source_date', p_source_date,
    'target_date', p_target_date,
    'records_copied', inserted_count,
    'records_replaced', deleted_count
  );
END;
$function$;