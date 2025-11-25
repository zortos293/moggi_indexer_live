-- PostgreSQL Schema for Monad Blockchain Indexer
-- Converted from SQLite schema

-- NOTE: Tables are created with IF NOT EXISTS to preserve existing data
-- To fully recreate, manually drop tables first

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
    number BIGINT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    parent_hash TEXT NOT NULL,
    nonce TEXT,
    sha3_uncles TEXT,
    logs_bloom TEXT,
    transactions_root TEXT,
    state_root TEXT,
    receipts_root TEXT,
    miner TEXT NOT NULL,
    difficulty TEXT,
    total_difficulty TEXT,
    extra_data TEXT,
    size INTEGER,
    gas_limit BIGINT,
    gas_used BIGINT,
    timestamp BIGINT NOT NULL,
    base_fee_per_gas TEXT,
    transaction_count INTEGER DEFAULT 0,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_index INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT,
    value TEXT NOT NULL,
    gas BIGINT NOT NULL,
    gas_price TEXT,
    max_fee_per_gas TEXT,
    max_priority_fee_per_gas TEXT,
    input TEXT,
    nonce BIGINT NOT NULL,
    type INTEGER,
    chain_id INTEGER,
    v TEXT,
    r TEXT,
    s TEXT,
    access_list TEXT,
    status INTEGER,
    gas_used BIGINT,
    cumulative_gas_used BIGINT,
    effective_gas_price TEXT,
    contract_address TEXT,
    logs_count INTEGER DEFAULT 0,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Transaction logs (events)
CREATE TABLE IF NOT EXISTS logs (
    id BIGSERIAL PRIMARY KEY,
    transaction_hash TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    address TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    data TEXT,
    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    removed INTEGER DEFAULT 0,
    event_name TEXT,
    event_signature TEXT,
    event_standard TEXT,
    decoded_params TEXT,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    address TEXT PRIMARY KEY,
    creator_address TEXT,
    creation_tx_hash TEXT,
    creation_block_number BIGINT,
    bytecode TEXT,
    is_erc20 INTEGER DEFAULT 0,
    is_erc721 INTEGER DEFAULT 0,
    is_erc1155 INTEGER DEFAULT 0,
    abi TEXT,
    verified INTEGER DEFAULT 0,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- ERC20 Token Metadata
CREATE TABLE IF NOT EXISTS erc20_tokens (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    total_supply TEXT,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- ERC721 Token Metadata
CREATE TABLE IF NOT EXISTS erc721_tokens (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    total_supply TEXT,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- ERC1155 Token Metadata
CREATE TABLE IF NOT EXISTS erc1155_tokens (
    address TEXT PRIMARY KEY,
    uri TEXT,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Addresses (wallets and contracts)
CREATE TABLE IF NOT EXISTS addresses (
    address TEXT PRIMARY KEY,
    first_seen_block BIGINT NOT NULL,
    first_seen_tx TEXT NOT NULL,
    is_contract INTEGER DEFAULT 0,
    tx_count INTEGER DEFAULT 0,
    balance TEXT DEFAULT '0',
    last_updated_block BIGINT,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Address transactions junction
CREATE TABLE IF NOT EXISTS address_transactions (
    address TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    is_from INTEGER DEFAULT 0,
    is_to INTEGER DEFAULT 0,
    PRIMARY KEY (address, transaction_hash)
);

-- ERC20 Transfers
CREATE TABLE IF NOT EXISTS erc20_transfers (
    id BIGSERIAL PRIMARY KEY,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    value TEXT NOT NULL,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- ERC721 Transfers
CREATE TABLE IF NOT EXISTS erc721_transfers (
    id BIGSERIAL PRIMARY KEY,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    token_id TEXT NOT NULL,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- ERC1155 Transfers
CREATE TABLE IF NOT EXISTS erc1155_transfers (
    id BIGSERIAL PRIMARY KEY,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    operator_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    token_id TEXT NOT NULL,
    value TEXT NOT NULL,
    indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Indexing progress tracking
CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    forward_block BIGINT DEFAULT 0,
    backward_block BIGINT,
    latest_block BIGINT,
    is_synced INTEGER DEFAULT 0,
    last_updated BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Insert initial state
INSERT INTO indexer_state (id, forward_block, is_synced)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;
