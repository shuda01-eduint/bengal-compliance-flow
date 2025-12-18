-- Function to sync departments from employees table
CREATE OR REPLACE FUNCTION sync_departments_from_employees()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  -- Insert unique departments from employees
  WITH new_depts AS (
    INSERT INTO departments (name)
    SELECT DISTINCT department 
    FROM employees 
    WHERE department IS NOT NULL AND department != ''
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM new_depts;
  
  RETURN jsonb_build_object(
    'departments_created', inserted_count,
    'total_departments', (SELECT COUNT(*) FROM departments)
  );
END;
$$;

-- Function to bulk assign department heads from email list
CREATE OR REPLACE FUNCTION bulk_assign_department_heads(
  head_emails text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
  not_found_emails text[] := '{}';
  email_item text;
  emp_dept text;
  dept_id uuid;
BEGIN
  FOREACH email_item IN ARRAY head_emails
  LOOP
    -- Get employee's department
    SELECT department INTO emp_dept
    FROM employees WHERE LOWER(email) = LOWER(TRIM(email_item));
    
    IF emp_dept IS NOT NULL THEN
      -- Get department id (create if needed)
      SELECT id INTO dept_id FROM departments WHERE name = emp_dept;
      
      IF dept_id IS NULL THEN
        INSERT INTO departments (name) VALUES (emp_dept) RETURNING id INTO dept_id;
      END IF;
      
      -- Update profile
      UPDATE profiles 
      SET is_department_head = true, department_id = dept_id
      WHERE LOWER(email) = LOWER(TRIM(email_item));
      
      IF FOUND THEN
        updated_count := updated_count + 1;
      END IF;
    ELSE
      not_found_emails := array_append(not_found_emails, email_item);
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'updated', updated_count, 
    'total_provided', array_length(head_emails, 1),
    'not_found', not_found_emails
  );
END;
$$;