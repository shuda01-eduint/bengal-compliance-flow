-- First add rm_email column to balances_raw if it doesn't exist
ALTER TABLE balances_raw ADD COLUMN IF NOT EXISTS rm_email text;

-- Insert employees from static data
INSERT INTO employees (employee_id, name, designation, department, branch, email, status, manager, joining_date) VALUES
('30001', 'Mir Masudul Hasan Chowdhury', 'AVP', 'Chattogram', 'Chattogram Branch', 'hasan.masudul@ucbstock.com.bd', 'Active', 'Mohammad Monjurul Alam', CURRENT_DATE),
('30003', 'Mahmuda Akter Dali', 'SEO', 'Settlement & Support Services', 'Head Office', 'mahmuda.dali@ucbstock.com.bd', 'Active', 'Belal Hossain', CURRENT_DATE),
('30011', 'Belal Hossain', 'FAVP', 'Settlement & Support Services', 'Head Office', 'b.hossain@ucbstock.com.bd', 'Active', 'Mohammed Rahmat Pasha', CURRENT_DATE),
('30013', 'Md. Shaiful Islam', 'SEO', 'Retail Sales', 'Extension of Head Office, Dilkusha', 'islam.shaiful@ucbstock.com.bd', 'Active', 'Md. Toiubulla Chowdhury', CURRENT_DATE),
('30020', 'S.M. Nusrat Shahab Uddin', 'SEO', 'Chattogram', 'Chattogram Branch', 'smnusrat.uddin@ucbstock.com.bd', 'Active', 'Mohammad Monjurul Alam', CURRENT_DATE),
('30022', 'Md. Kazi Nazmul Hasan', 'FAVP', 'Priority Brokerage Services', 'Extension of Head Office, Nik Tower', 'mkazi.hasan@ucbstock.com.bd', 'Active', 'Ashfaque Mahmood', CURRENT_DATE),
('30029', 'Tahmidur Rahman', 'FAVP', 'Institutional Sales, Gulshan', 'Head Office', 'rahman.tahmidur@ucbstock.com.bd', 'Active', 'Mohammed Rahmat Pasha', CURRENT_DATE),
('30030', 'Arif Reza', 'EO', 'Imperial Brokerage Services', 'Head Office', 'arif.reza@ucbstock.com.bd', 'Active', 'Misbahus Sualahin Siddiquy', CURRENT_DATE),
('30032', 'Md. Rezaul Karim', 'SO', 'Retail Sales', 'Extension of Head Office, Dilkusha', 'rezaul.mkarim@ucbstock.com.bd', 'Active', 'Md. Toiubulla Chowdhury', CURRENT_DATE),
('30036', 'Md. Redoanul Haque Dolon', 'AVP', 'Finance and Accounts', 'Head Office', 'redoanul.haque@ucbstock.com.bd', 'Active', 'Sazzad Mahmud', CURRENT_DATE),
('30039', 'Md. Atikuzzaman', 'EO', 'Retail Sales', 'Extension of Head Office, Dilkusha', 'atik.zaman@ucbstock.com.bd', 'Active', 'Md. Toiubulla Chowdhury', CURRENT_DATE),
('30144', 'Pronay Saha', 'FAVP', 'Privileged Brokerage Services', 'Extension of Head Office, Sun-Moon-Star Tower', 'pronay.saha@ucbstock.com.bd', 'Active', 'Md. Maniruzzaman', CURRENT_DATE)
ON CONFLICT (employee_id) DO UPDATE SET
  name = EXCLUDED.name,
  designation = EXCLUDED.designation,
  department = EXCLUDED.department,
  branch = EXCLUDED.branch,
  email = EXCLUDED.email,
  manager = EXCLUDED.manager;

-- Update balances_raw to set rm_email from employees table based on rm_id
UPDATE balances_raw br
SET rm_email = e.email
FROM employees e
WHERE br.rm_id = e.employee_id;

-- Create function to get employee_id from user's email
CREATE OR REPLACE FUNCTION public.get_employee_id_for_user()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id 
  FROM employees 
  WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
  LIMIT 1
$$;

-- Drop existing RLS policies on balances_raw that might conflict
DROP POLICY IF EXISTS "RMs can view their balances_raw" ON balances_raw;

-- New policy: RMs can view balances where rm_id matches their employee_id
CREATE POLICY "RMs can view their balances_raw by employee_id"
ON balances_raw
FOR SELECT
USING (
  rm_id = get_employee_id_for_user()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.is_approved = true
  )
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_balances_raw_rm_id ON balances_raw(rm_id);
CREATE INDEX IF NOT EXISTS idx_balances_raw_rm_email ON balances_raw(rm_email);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);