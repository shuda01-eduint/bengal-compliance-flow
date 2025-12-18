-- Add new roles to app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'mancom';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'branch_manager';

-- Add is_mancom flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_mancom BOOLEAN NOT NULL DEFAULT false;

-- Create outlet_managers table to store outlet → manager → mancom relationships
CREATE TABLE IF NOT EXISTS public.outlet_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_name TEXT NOT NULL,
  manager_id TEXT,
  manager_name TEXT,
  manager_email TEXT,
  mancom_id TEXT NOT NULL,
  mancom_name TEXT,
  mancom_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(outlet_name)
);

-- Enable RLS on outlet_managers
ALTER TABLE public.outlet_managers ENABLE ROW LEVEL SECURITY;

-- RLS policies for outlet_managers
CREATE POLICY "Admins can manage outlet_managers"
ON public.outlet_managers FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view outlet_managers"
ON public.outlet_managers FOR SELECT
USING (true);

-- Create function to check if user is MANCOM of an RM
CREATE OR REPLACE FUNCTION public.is_mancom_of_rm(_rm_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles AS mancom_profile
    JOIN public.outlet_managers AS om ON LOWER(om.mancom_email) = LOWER(mancom_profile.email)
    WHERE mancom_profile.id = auth.uid()
      AND mancom_profile.is_mancom = true
      AND mancom_profile.is_approved = true
      AND LOWER(om.manager_email) = LOWER(_rm_email)
  )
$$;

-- Create bulk assign function for importing MANCOM/Manager data
CREATE OR REPLACE FUNCTION public.bulk_assign_mancom_managers(
  managers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
  updated_profiles integer := 0;
  manager_record jsonb;
  mancom_emails text[] := '{}';
  manager_emails text[] := '{}';
  email_item text;
BEGIN
  -- Clear existing outlet_managers data and insert new
  DELETE FROM outlet_managers;
  
  -- Insert new outlet manager records
  FOR manager_record IN SELECT * FROM jsonb_array_elements(managers)
  LOOP
    INSERT INTO outlet_managers (
      outlet_name,
      manager_id,
      manager_name,
      manager_email,
      mancom_id,
      mancom_name,
      mancom_email
    ) VALUES (
      manager_record->>'outlet_name',
      manager_record->>'manager_id',
      manager_record->>'manager_name',
      manager_record->>'manager_email',
      manager_record->>'mancom_id',
      manager_record->>'mancom_name',
      manager_record->>'mancom_email'
    )
    ON CONFLICT (outlet_name) DO UPDATE SET
      manager_id = EXCLUDED.manager_id,
      manager_name = EXCLUDED.manager_name,
      manager_email = EXCLUDED.manager_email,
      mancom_id = EXCLUDED.mancom_id,
      mancom_name = EXCLUDED.mancom_name,
      mancom_email = EXCLUDED.mancom_email,
      updated_at = now();
    
    inserted_count := inserted_count + 1;
    
    -- Collect unique MANCOM and Manager emails
    IF manager_record->>'mancom_email' IS NOT NULL THEN
      mancom_emails := array_append(mancom_emails, LOWER(TRIM(manager_record->>'mancom_email')));
    END IF;
    IF manager_record->>'manager_email' IS NOT NULL THEN
      manager_emails := array_append(manager_emails, LOWER(TRIM(manager_record->>'manager_email')));
    END IF;
  END LOOP;
  
  -- Get unique emails
  mancom_emails := ARRAY(SELECT DISTINCT unnest(mancom_emails));
  manager_emails := ARRAY(SELECT DISTINCT unnest(manager_emails));
  
  -- Update profiles: set is_mancom = true for MANCOM emails
  UPDATE profiles 
  SET is_mancom = true
  WHERE LOWER(email) = ANY(mancom_emails);
  
  GET DIAGNOSTICS updated_profiles = ROW_COUNT;
  
  -- Assign 'mancom' role to MANCOM members
  FOREACH email_item IN ARRAY mancom_emails
  LOOP
    INSERT INTO user_roles (user_id, role)
    SELECT p.id, 'mancom'::app_role
    FROM profiles p
    WHERE LOWER(p.email) = email_item
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
  
  -- Assign 'branch_manager' role to Branch Managers (excluding those who are also MANCOM)
  FOREACH email_item IN ARRAY manager_emails
  LOOP
    IF NOT (email_item = ANY(mancom_emails)) THEN
      INSERT INTO user_roles (user_id, role)
      SELECT p.id, 'branch_manager'::app_role
      FROM profiles p
      WHERE LOWER(p.email) = email_item
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'outlets_imported', inserted_count,
    'mancom_profiles_updated', updated_profiles,
    'unique_mancom_emails', array_length(mancom_emails, 1),
    'unique_manager_emails', array_length(manager_emails, 1)
  );
END;
$$;