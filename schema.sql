-- Monad Blockchain Indexer Schema
-- Optimized for high-speed indexing with proper indexes

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
    number INTEGER PRIMARY KEY,
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
    gas_limit INTEGER,
    gas_used INTEGER,
    timestamp INTEGER NOT NULL,
    base_fee_per_gas TEXT,
    transaction_count INTEGER DEFAULT 0,
    indexed_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX IF NOT EXISTS idx_blocks_miner ON blocks(miner);
CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_index INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT,
    value TEXT NOT NULL,
    gas INTEGER NOT NULL,
    gas_price TEXT,
    max_fee_per_gas TEXT,
    max_priority_fee_per_gas TEXT,
    input TEXT,
    nonce INTEGER NOT NULL,
    type INTEGER,
    chain_id INTEGER,
    v TEXT,
    r TEXT,
    s TEXT,
    access_list TEXT, -- JSON
    status INTEGER, -- 1 success, 0 failed
    gas_used INTEGER,
    cumulative_gas_used INTEGER,
    effective_gas_price TEXT,
    contract_address TEXT, -- if contract creation
    logs_count INTEGER DEFAULT 0,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (block_number) REFERENCES blocks(number)
);

CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_tx_contract ON transactions(contract_address);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

-- Transaction logs (events)
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    address TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    data TEXT,
    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    removed INTEGER DEFAULT 0,
    -- Decoded event information
    event_name TEXT,
    event_signature TEXT,
    event_standard TEXT,
    decoded_params TEXT, -- JSON
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (transaction_hash) REFERENCES transactions(hash),
    FOREIGN KEY (block_number) REFERENCES blocks(number)
);

CREATE INDEX IF NOT EXISTS idx_logs_tx ON logs(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_logs_block ON logs(block_number);
CREATE INDEX IF NOT EXISTS idx_logs_address ON logs(address);
CREATE INDEX IF NOT EXISTS idx_logs_topic0 ON logs(topic0);
CREATE INDEX IF NOT EXISTS idx_logs_topic1 ON logs(topic1);
CREATE INDEX IF NOT EXISTS idx_logs_topic2 ON logs(topic2);
CREATE INDEX IF NOT EXISTS idx_logs_topic3 ON logs(topic3);
CREATE INDEX IF NOT EXISTS idx_logs_event_name ON logs(event_name);
CREATE INDEX IF NOT EXISTS idx_logs_event_standard ON logs(event_standard);

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    address TEXT PRIMARY KEY,
    creator_address TEXT,
    creation_tx_hash TEXT,
    creation_block_number INTEGER,
    bytecode TEXT,
    is_erc20 INTEGER DEFAULT 0,
    is_erc721 INTEGER DEFAULT 0,
    is_erc1155 INTEGER DEFAULT 0,
    abi TEXT, -- JSON
    verified INTEGER DEFAULT 0,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (creation_tx_hash) REFERENCES transactions(hash),
    FOREIGN KEY (creation_block_number) REFERENCES blocks(number)
);

CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_address);
CREATE INDEX IF NOT EXISTS idx_contracts_block ON contracts(creation_block_number);
CREATE INDEX IF NOT EXISTS idx_contracts_erc20 ON contracts(is_erc20);
CREATE INDEX IF NOT EXISTS idx_contracts_erc721 ON contracts(is_erc721);
CREATE INDEX IF NOT EXISTS idx_contracts_erc1155 ON contracts(is_erc1155);

-- ERC20 Token Metadata
CREATE TABLE IF NOT EXISTS erc20_tokens (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    total_supply TEXT,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (address) REFERENCES contracts(address)
);

CREATE INDEX IF NOT EXISTS idx_erc20_symbol ON erc20_tokens(symbol);
CREATE INDEX IF NOT EXISTS idx_erc20_name ON erc20_tokens(name);

-- ERC721 Token Metadata
CREATE TABLE IF NOT EXISTS erc721_tokens (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    total_supply TEXT,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (address) REFERENCES contracts(address)
);

-- ERC1155 Token Metadata
CREATE TABLE IF NOT EXISTS erc1155_tokens (
    address TEXT PRIMARY KEY,
    uri TEXT,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (address) REFERENCES contracts(address)
);

-- Addresses (wallets and contracts)
CREATE TABLE IF NOT EXISTS addresses (
    address TEXT PRIMARY KEY,
    first_seen_block INTEGER NOT NULL,
    first_seen_tx TEXT NOT NULL,
    is_contract INTEGER DEFAULT 0,
    tx_count INTEGER DEFAULT 0,
    balance TEXT DEFAULT '0',
    last_updated_block INTEGER,
    indexed_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_addresses_first_block ON addresses(first_seen_block);
CREATE INDEX IF NOT EXISTS idx_addresses_is_contract ON addresses(is_contract);

-- Address transactions junction (for quick address history)
CREATE TABLE IF NOT EXISTS address_transactions (
    address TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    is_from INTEGER DEFAULT 0,
    is_to INTEGER DEFAULT 0,
    PRIMARY KEY (address, transaction_hash),
    FOREIGN KEY (address) REFERENCES addresses(address),
    FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)
);

CREATE INDEX IF NOT EXISTS idx_addr_tx_block ON address_transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_addr_tx_address ON address_transactions(address);

-- ERC20 Transfers
CREATE TABLE IF NOT EXISTS erc20_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    value TEXT NOT NULL,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (transaction_hash) REFERENCES transactions(hash),
    FOREIGN KEY (token_address) REFERENCES erc20_tokens(address)
);

CREATE INDEX IF NOT EXISTS idx_erc20_tx ON erc20_transfers(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_erc20_token ON erc20_transfers(token_address);
CREATE INDEX IF NOT EXISTS idx_erc20_from ON erc20_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_erc20_to ON erc20_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_erc20_block ON erc20_transfers(block_number);

-- ERC721 Transfers
CREATE TABLE IF NOT EXISTS erc721_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    token_id TEXT NOT NULL,
    indexed_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (transaction_hash) REFERENCES transactions(hash),
    FOREIGN KEY (token_address) REFERENCES erc721_tokens(address)
);

CREATE INDEX IF NOT EXISTS idx_erc721_tx ON erc721_transfers(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_erc721_token ON erc721_transfers(token_address);
CREATE INDEX IF NOT EXISTS idx_erc721_from ON erc721_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_erc721_to ON erc721_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_erc721_block ON erc721_transfers(block_number);

-- Indexing progress tracking
CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    forward_block INTEGER DEFAULT 0, -- indexing from 0 upward
    backward_block INTEGER, -- indexing from latest downward
    latest_block INTEGER,
    is_synced INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT (unixepoch())
);

-- Insert initial state
INSERT OR IGNORE INTO indexer_state (id, forward_block, is_synced)
VALUES (1, 0, 0);

-- Performance optimization: WAL mode for concurrent reads
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000; -- 64MB cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000000; -- 30GB mmap
