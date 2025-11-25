-- Migration to add event decoding fields to existing database
-- Run this if you already have a database with indexed data

-- Add new columns to logs table
ALTER TABLE logs ADD COLUMN event_name TEXT;
ALTER TABLE logs ADD COLUMN event_signature TEXT;
ALTER TABLE logs ADD COLUMN event_standard TEXT;
ALTER TABLE logs ADD COLUMN decoded_params TEXT;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_logs_event_name ON logs(event_name);
CREATE INDEX IF NOT EXISTS idx_logs_event_standard ON logs(event_standard);

-- Note: Existing logs won't have decoded events until you re-index
-- Or you can run a script to decode existing logs
