-- Migration: Add auto-approval preference column to CMO table
-- Date: 2026-02-14

ALTER TABLE cmo 
ADD COLUMN auto_approval_enabled BOOLEAN DEFAULT FALSE AFTER e_mail;

-- Add index for efficient queries
CREATE INDEX idx_cmo_auto_approval ON cmo(cmo_id, auto_approval_enabled);

-- Verify the column was added
DESC cmo;
