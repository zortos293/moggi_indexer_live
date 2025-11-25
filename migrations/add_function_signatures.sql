-- Migration: Add function_signatures table
-- This table stores function and event signatures extracted from ABIs

CREATE TABLE IF NOT EXISTS function_signatures (
    selector TEXT PRIMARY KEY,  -- 4-byte selector (0x12345678) for functions, topic hash for events
    name TEXT NOT NULL,
    signature TEXT NOT NULL,  -- Full signature like "transfer(address,uint256)"
    type TEXT NOT NULL,  -- 'function' or 'event'
    inputs TEXT,  -- JSON array of input parameters
    outputs TEXT,  -- JSON array of output parameters (for functions)
    state_mutability TEXT,  -- 'view', 'pure', 'payable', 'nonpayable'
    source_contract TEXT,  -- Contract name where this was found
    source_file TEXT,  -- ABI file path where this was found
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_function_signatures_name ON function_signatures(name);
CREATE INDEX IF NOT EXISTS idx_function_signatures_type ON function_signatures(type);

-- Also create SQLite version for compatibility
-- Run this in SQLite if using SQLite database:
/*
CREATE TABLE IF NOT EXISTS function_signatures (
    selector TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    signature TEXT NOT NULL,
    type TEXT NOT NULL,
    inputs TEXT,
    outputs TEXT,
    state_mutability TEXT,
    source_contract TEXT,
    source_file TEXT,
    indexed_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_function_signatures_name ON function_signatures(name);
CREATE INDEX IF NOT EXISTS idx_function_signatures_type ON function_signatures(type);
*/
