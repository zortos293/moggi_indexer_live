-- PlanetScale/MySQL Schema for Monad Blockchain Indexer
-- Converted from PostgreSQL schema
-- NOTE: PlanetScale does not support foreign keys, so they are omitted

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
    number BIGINT PRIMARY KEY,
    hash VARCHAR(66) NOT NULL UNIQUE,
    parent_hash VARCHAR(66) NOT NULL,
    nonce VARCHAR(20),
    sha3_uncles TEXT,
    logs_bloom TEXT,
    transactions_root TEXT,
    state_root TEXT,
    receipts_root TEXT,
    miner VARCHAR(42) NOT NULL,
    difficulty TEXT,
    total_difficulty TEXT,
    extra_data TEXT,
    size INT,
    gas_limit BIGINT,
    gas_used BIGINT,
    timestamp BIGINT NOT NULL,
    base_fee_per_gas TEXT,
    transaction_count INT DEFAULT 0,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_blocks_timestamp (timestamp),
    INDEX idx_blocks_miner (miner),
    INDEX idx_blocks_hash (hash)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    hash VARCHAR(66) PRIMARY KEY,
    block_number BIGINT NOT NULL,
    block_hash VARCHAR(66) NOT NULL,
    transaction_index INT NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42),
    value TEXT NOT NULL,
    gas BIGINT NOT NULL,
    gas_price TEXT,
    max_fee_per_gas TEXT,
    max_priority_fee_per_gas TEXT,
    input MEDIUMTEXT,
    nonce BIGINT NOT NULL,
    type INT,
    chain_id INT,
    v TEXT,
    r TEXT,
    s TEXT,
    access_list TEXT,
    status INT,
    gas_used BIGINT,
    cumulative_gas_used BIGINT,
    effective_gas_price TEXT,
    contract_address VARCHAR(42),
    logs_count INT DEFAULT 0,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_tx_block_number (block_number),
    INDEX idx_tx_from_address (from_address),
    INDEX idx_tx_to_address (to_address),
    INDEX idx_tx_contract_address (contract_address),
    INDEX idx_tx_status (status),
    INDEX idx_tx_type (type)
);

-- Transaction logs (events)
CREATE TABLE IF NOT EXISTS logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash VARCHAR(66) NOT NULL,
    address VARCHAR(42) NOT NULL,
    log_index INT NOT NULL,
    data MEDIUMTEXT,
    topic0 VARCHAR(66),
    topic1 VARCHAR(66),
    topic2 VARCHAR(66),
    topic3 VARCHAR(66),
    removed TINYINT DEFAULT 0,
    event_name VARCHAR(255),
    event_signature VARCHAR(255),
    event_standard VARCHAR(20),
    decoded_params TEXT,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_logs_tx_hash (transaction_hash),
    INDEX idx_logs_block_number (block_number),
    INDEX idx_logs_address (address),
    INDEX idx_logs_topic0 (topic0),
    INDEX idx_logs_topic1 (topic1),
    INDEX idx_logs_topic2 (topic2),
    INDEX idx_logs_topic3 (topic3),
    INDEX idx_logs_event_name (event_name),
    INDEX idx_logs_event_standard (event_standard)
);

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    address VARCHAR(42) PRIMARY KEY,
    creator_address VARCHAR(42),
    creation_tx_hash VARCHAR(66),
    creation_block_number BIGINT,
    bytecode MEDIUMTEXT,
    is_erc20 TINYINT DEFAULT 0,
    is_erc721 TINYINT DEFAULT 0,
    is_erc1155 TINYINT DEFAULT 0,
    abi MEDIUMTEXT,
    verified TINYINT DEFAULT 0,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_contracts_creator (creator_address),
    INDEX idx_contracts_creation_block (creation_block_number),
    INDEX idx_contracts_erc20 (is_erc20),
    INDEX idx_contracts_erc721 (is_erc721),
    INDEX idx_contracts_erc1155 (is_erc1155)
);

-- ERC20 Token Metadata
CREATE TABLE IF NOT EXISTS erc20_tokens (
    address VARCHAR(42) PRIMARY KEY,
    name VARCHAR(255),
    symbol VARCHAR(50),
    decimals INT,
    total_supply TEXT,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_erc20_symbol (symbol),
    INDEX idx_erc20_name (name)
);

-- ERC721 Token Metadata
CREATE TABLE IF NOT EXISTS erc721_tokens (
    address VARCHAR(42) PRIMARY KEY,
    name VARCHAR(255),
    symbol VARCHAR(50),
    total_supply TEXT,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP())
);

-- ERC1155 Token Metadata
CREATE TABLE IF NOT EXISTS erc1155_tokens (
    address VARCHAR(42) PRIMARY KEY,
    uri TEXT,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP())
);

-- Addresses (wallets and contracts)
CREATE TABLE IF NOT EXISTS addresses (
    address VARCHAR(42) PRIMARY KEY,
    first_seen_block BIGINT NOT NULL,
    first_seen_tx VARCHAR(66) NOT NULL,
    is_contract TINYINT DEFAULT 0,
    tx_count INT DEFAULT 0,
    balance TEXT DEFAULT '0',
    last_updated_block BIGINT,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_addresses_first_block (first_seen_block),
    INDEX idx_addresses_is_contract (is_contract)
);

-- Address transactions junction
CREATE TABLE IF NOT EXISTS address_transactions (
    address VARCHAR(42) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    is_from TINYINT DEFAULT 0,
    is_to TINYINT DEFAULT 0,
    PRIMARY KEY (address, transaction_hash),
    INDEX idx_addr_tx_block (block_number),
    INDEX idx_addr_tx_address (address)
);

-- ERC20 Transfers
CREATE TABLE IF NOT EXISTS erc20_transfers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INT NOT NULL,
    block_number BIGINT NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    value TEXT NOT NULL,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_erc20_tx_hash (transaction_hash),
    INDEX idx_erc20_token (token_address),
    INDEX idx_erc20_from (from_address),
    INDEX idx_erc20_to (to_address),
    INDEX idx_erc20_block (block_number)
);

-- ERC721 Transfers
CREATE TABLE IF NOT EXISTS erc721_transfers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INT NOT NULL,
    block_number BIGINT NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    token_id TEXT NOT NULL,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_erc721_tx_hash (transaction_hash),
    INDEX idx_erc721_token (token_address),
    INDEX idx_erc721_from (from_address),
    INDEX idx_erc721_to (to_address),
    INDEX idx_erc721_block (block_number)
);

-- ERC1155 Transfers
CREATE TABLE IF NOT EXISTS erc1155_transfers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INT NOT NULL,
    block_number BIGINT NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    operator_address VARCHAR(42) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    token_id TEXT NOT NULL,
    value TEXT NOT NULL,
    indexed_at BIGINT DEFAULT (UNIX_TIMESTAMP()),
    INDEX idx_erc1155_tx_hash (transaction_hash),
    INDEX idx_erc1155_token (token_address),
    INDEX idx_erc1155_operator (operator_address),
    INDEX idx_erc1155_from (from_address),
    INDEX idx_erc1155_to (to_address),
    INDEX idx_erc1155_block (block_number)
);

-- Indexing progress tracking
CREATE TABLE IF NOT EXISTS indexer_state (
    id INT PRIMARY KEY CHECK (id = 1),
    forward_block BIGINT DEFAULT 0,
    backward_block BIGINT,
    latest_block BIGINT,
    is_synced TINYINT DEFAULT 0,
    last_updated BIGINT DEFAULT (UNIX_TIMESTAMP())
);

-- Insert initial state
INSERT IGNORE INTO indexer_state (id, forward_block, is_synced)
VALUES (1, 0, 0);
