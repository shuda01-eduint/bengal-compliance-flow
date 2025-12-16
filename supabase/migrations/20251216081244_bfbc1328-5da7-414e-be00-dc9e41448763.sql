-- Add index on file_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_trade_history_file_name ON trade_history(file_name);

-- Create a function to get file upload statistics efficiently
CREATE OR REPLACE FUNCTION get_trade_file_stats()
RETURNS TABLE (
  file_name text,
  record_count bigint,
  unique_clients bigint,
  total_value numeric,
  first_upload timestamptz,
  last_upload timestamptz
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    file_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT client_code) as unique_clients,
    COALESCE(SUM(value), 0) as total_value,
    MIN(uploaded_at) as first_upload,
    MAX(uploaded_at) as last_upload
  FROM trade_history
  WHERE file_name IS NOT NULL
  GROUP BY file_name
  ORDER BY last_upload DESC;
$$;