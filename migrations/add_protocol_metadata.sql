-- Protocol/Company metadata table
CREATE TABLE IF NOT EXISTS protocols (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    logo_url TEXT,
    website TEXT,
    twitter TEXT,
    github TEXT,
    docs TEXT,
    discord TEXT,
    telegram TEXT,
    is_live BOOLEAN DEFAULT true,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Contract to Protocol mapping (one contract can belong to one protocol)
CREATE TABLE IF NOT EXISTS contract_metadata (
    address TEXT PRIMARY KEY,
    protocol_id INTEGER REFERENCES protocols(id),
    contract_name TEXT,  -- e.g., "MonadSettler", "Router", etc.
    nickname TEXT,       -- custom user-defined nickname
    notes TEXT,          -- any additional notes
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_contract_metadata_protocol ON contract_metadata(protocol_id);
CREATE INDEX IF NOT EXISTS idx_protocols_name ON protocols(name);
