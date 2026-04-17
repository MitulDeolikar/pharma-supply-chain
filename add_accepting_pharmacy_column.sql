-- Add accepting_pharmacy_id column to pharmacy_demand_request table if it doesn't exist
-- This will make demand requests work like emergency requests

-- Check if the column already exists and add it if not
SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT * FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'major' 
      AND TABLE_NAME = 'pharmacy_demand_request' 
      AND COLUMN_NAME = 'accepting_pharmacy_id'
    ),
    'SELECT "Column accepting_pharmacy_id already exists";',
    'ALTER TABLE pharmacy_demand_request ADD COLUMN accepting_pharmacy_id INT NULL, ADD FOREIGN KEY (accepting_pharmacy_id) REFERENCES pharmacy(pharmacy_id);'
  )
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional: View the current structure of the table
DESCRIBE pharmacy_demand_request;