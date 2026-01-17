-- Create a function to delete all holdings in batches to avoid statement timeout
CREATE OR REPLACE FUNCTION delete_all_holdings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  deleted_count integer := 0;
  batch_deleted integer;
BEGIN
  LOOP
    DELETE FROM holdings
    WHERE id IN (
      SELECT id FROM holdings LIMIT 5000
    );
    
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_count := deleted_count + batch_deleted;
    
    EXIT WHEN batch_deleted = 0;
  END LOOP;
  
  RETURN deleted_count;
END;
$$;