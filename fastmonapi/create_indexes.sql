-- Critical indexes for fast API queries

-- Blocks: fast latest blocks query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_number_desc ON blocks(number DESC);

-- Transactions: fast latest transactions and address lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_block_number_desc ON transactions(block_number DESC, transaction_index DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_from_address ON transactions(from_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_to_address ON transactions(to_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_hash ON transactions(hash);

-- Logs: for token transfer lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_tx_hash ON logs(transaction_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_topic0 ON logs(topic0);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_address ON logs(address);

-- ERC20 transfers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc20_transfers_from ON erc20_transfers(from_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc20_transfers_to ON erc20_transfers(to_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc20_transfers_block ON erc20_transfers(block_number DESC);

-- ERC721 transfers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc721_transfers_from ON erc721_transfers(from_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc721_transfers_to ON erc721_transfers(to_address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc721_transfers_block ON erc721_transfers(block_number DESC);

-- Addresses
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_address ON addresses(address);

-- ERC20 tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc20_tokens_address ON erc20_tokens(address);

-- ERC721 tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_erc721_tokens_address ON erc721_tokens(address);

-- Contracts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_address ON contracts(address);

-- Analyze tables after creating indexes
ANALYZE blocks;
ANALYZE transactions;
ANALYZE logs;
ANALYZE erc20_transfers;
ANALYZE erc721_transfers;
ANALYZE addresses;
ANALYZE erc20_tokens;
ANALYZE erc721_tokens;
ANALYZE contracts;
