-- First, delete ALL duplicates using a more robust method with row_number
WITH duplicates AS (
  SELECT id, 
         ROW_NUMBER() OVER (
           PARTITION BY investor_code, transaction_date, transaction_type, amount 
           ORDER BY created_at, id
         ) as rn
  FROM deposits_withdrawals
)
DELETE FROM deposits_withdrawals
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Now create unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS deposits_withdrawals_unique_transaction
ON deposits_withdrawals (investor_code, transaction_date, transaction_type, amount);