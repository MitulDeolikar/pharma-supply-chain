-- Add blockchain tracking columns to pharmacy_emergency_requests
-- This allows us to verify integrity by knowing when the record was recorded on blockchain

ALTER TABLE pharmacy_emergency_requests
ADD COLUMN blockchain_timestamp INT NULL COMMENT 'Unix timestamp when recorded on blockchain',
ADD COLUMN blockchain_txhash VARCHAR(66) NULL COMMENT 'Blockchain transaction hash',
ADD COLUMN last_verified_timestamp INT NULL COMMENT 'Last timestamp verification was done';

-- Create index for faster lookups
CREATE INDEX idx_blockchain_timestamp ON pharmacy_emergency_requests(blockchain_timestamp);
