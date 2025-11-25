-- Useful SQL Queries for Monad Indexer

-- ============================================
-- BLOCKS
-- ============================================

-- Latest blocks
SELECT number, hash, miner, transaction_count, gas_used, timestamp
FROM blocks
ORDER BY number DESC
LIMIT 20;

-- Blocks by specific miner
SELECT *
FROM blocks
WHERE miner = '0x...'
ORDER BY number DESC;

-- Block statistics
SELECT
  COUNT(*) as total_blocks,
  AVG(transaction_count) as avg_txs_per_block,
  AVG(gas_used) as avg_gas_used,
  MAX(gas_used) as max_gas_used,
  MIN(timestamp) as first_block_time,
  MAX(timestamp) as last_block_time
FROM blocks;

-- Top miners
SELECT
  miner,
  COUNT(*) as blocks_mined,
  SUM(transaction_count) as total_txs,
  AVG(gas_used) as avg_gas
FROM blocks
GROUP BY miner
ORDER BY blocks_mined DESC
LIMIT 10;

-- ============================================
-- TRANSACTIONS
-- ============================================

-- Recent transactions
SELECT hash, from_address, to_address, value, gas_used, status, block_number
FROM transactions
ORDER BY block_number DESC
LIMIT 50;

-- Failed transactions
SELECT hash, from_address, to_address, value, input, block_number
FROM transactions
WHERE status = 0
ORDER BY block_number DESC;

-- Contract deployments
SELECT hash, from_address as deployer, contract_address, gas_used, block_number
FROM transactions
WHERE contract_address IS NOT NULL
ORDER BY block_number DESC;

-- Large value transfers
SELECT hash, from_address, to_address, value, block_number
FROM transactions
WHERE value > '1000000000000000000' -- > 1 ETH equivalent
ORDER BY CAST(value AS REAL) DESC
LIMIT 20;

-- Transaction type distribution
SELECT
  type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM transactions), 2) as percentage
FROM transactions
GROUP BY type;

-- ============================================
-- ADDRESSES
-- ============================================

-- Most active addresses
SELECT
  a.address,
  a.is_contract,
  COUNT(at.transaction_hash) as tx_count,
  a.first_seen_block
FROM addresses a
INNER JOIN address_transactions at ON a.address = at.address
GROUP BY a.address
ORDER BY tx_count DESC
LIMIT 20;

-- New addresses per block range
SELECT
  CAST(first_seen_block / 1000 AS INTEGER) * 1000 as block_range,
  COUNT(*) as new_addresses
FROM addresses
GROUP BY block_range
ORDER BY block_range DESC;

-- Contract vs EOA count
SELECT
  CASE WHEN is_contract = 1 THEN 'Contract' ELSE 'EOA' END as type,
  COUNT(*) as count
FROM addresses
GROUP BY is_contract;

-- ============================================
-- CONTRACTS
-- ============================================

-- Recent contract deployments
SELECT
  c.address,
  c.creator_address,
  c.creation_block_number,
  c.is_erc20,
  c.is_erc721,
  c.is_erc1155
FROM contracts c
ORDER BY c.creation_block_number DESC
LIMIT 20;

-- ERC20 contracts
SELECT
  c.address,
  e.name,
  e.symbol,
  e.decimals,
  e.total_supply,
  c.creation_block_number
FROM contracts c
INNER JOIN erc20_tokens e ON c.address = e.address
ORDER BY c.creation_block_number DESC;

-- Most deployed contract creators
SELECT
  creator_address,
  COUNT(*) as contracts_deployed
FROM contracts
GROUP BY creator_address
ORDER BY contracts_deployed DESC
LIMIT 10;

-- ============================================
-- TOKENS
-- ============================================

-- All ERC20 tokens
SELECT
  address,
  name,
  symbol,
  decimals,
  total_supply
FROM erc20_tokens
ORDER BY indexed_at DESC;

-- ERC20 tokens with most transfers
SELECT
  t.address,
  t.symbol,
  COUNT(tr.id) as transfer_count
FROM erc20_tokens t
LEFT JOIN erc20_transfers tr ON t.address = tr.token_address
GROUP BY t.address
ORDER BY transfer_count DESC;

-- Recent ERC20 transfers
SELECT
  et.token_address,
  e.symbol,
  et.from_address,
  et.to_address,
  et.value,
  et.block_number,
  et.transaction_hash
FROM erc20_transfers et
INNER JOIN erc20_tokens e ON et.token_address = e.address
ORDER BY et.block_number DESC
LIMIT 50;

-- Top ERC20 token receivers
SELECT
  to_address,
  COUNT(*) as receive_count
FROM erc20_transfers
GROUP BY to_address
ORDER BY receive_count DESC
LIMIT 20;

-- ERC721 tokens
SELECT
  address,
  name,
  symbol,
  total_supply
FROM erc721_tokens
ORDER BY indexed_at DESC;

-- Recent NFT transfers
SELECT
  et.token_address,
  e.symbol,
  et.from_address,
  et.to_address,
  et.token_id,
  et.block_number
FROM erc721_transfers et
INNER JOIN erc721_tokens e ON et.token_address = e.address
ORDER BY et.block_number DESC
LIMIT 50;

-- ============================================
-- LOGS / EVENTS
-- ============================================

-- Recent logs
SELECT
  transaction_hash,
  address,
  topic0,
  block_number,
  log_index
FROM logs
ORDER BY block_number DESC, log_index DESC
LIMIT 50;

-- Logs by contract
SELECT
  address,
  COUNT(*) as log_count
FROM logs
GROUP BY address
ORDER BY log_count DESC
LIMIT 20;

-- Transfer events (topic0)
SELECT
  address,
  topic1 as from_indexed,
  topic2 as to_indexed,
  data as value,
  block_number
FROM logs
WHERE topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
ORDER BY block_number DESC
LIMIT 50;

-- ============================================
-- ANALYTICS
-- ============================================

-- Daily transaction volume
SELECT
  DATE(timestamp, 'unixepoch') as date,
  COUNT(*) as block_count,
  SUM(transaction_count) as total_txs,
  AVG(gas_used) as avg_gas
FROM blocks
GROUP BY date
ORDER BY date DESC;

-- Gas usage analysis
SELECT
  MIN(gas_used) as min_gas,
  MAX(gas_used) as max_gas,
  AVG(gas_used) as avg_gas,
  SUM(gas_used) as total_gas
FROM transactions;

-- Contract interaction frequency
SELECT
  t.to_address,
  c.is_erc20,
  c.is_erc721,
  COUNT(*) as interaction_count
FROM transactions t
INNER JOIN contracts c ON t.to_address = c.address
WHERE t.to_address IS NOT NULL
GROUP BY t.to_address
ORDER BY interaction_count DESC
LIMIT 20;

-- Token holder distribution (ERC20)
SELECT
  token_address,
  COUNT(DISTINCT to_address) as unique_holders
FROM erc20_transfers
GROUP BY token_address
ORDER BY unique_holders DESC;

-- Transaction success rate
SELECT
  CASE WHEN status = 1 THEN 'Success' ELSE 'Failed' END as status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM transactions), 2) as percentage
FROM transactions
GROUP BY status;

-- ============================================
-- INDEXER STATE
-- ============================================

-- Current indexing progress
SELECT
  forward_block,
  backward_block,
  latest_block,
  CASE WHEN is_synced = 1 THEN 'Synced' ELSE 'Syncing' END as status,
  ROUND((forward_block * 100.0 / NULLIF(latest_block, 0)), 2) as percent_complete,
  DATETIME(last_updated, 'unixepoch') as last_updated
FROM indexer_state;

-- Database size statistics
SELECT
  (SELECT COUNT(*) FROM blocks) as blocks,
  (SELECT COUNT(*) FROM transactions) as transactions,
  (SELECT COUNT(*) FROM logs) as logs,
  (SELECT COUNT(*) FROM contracts) as contracts,
  (SELECT COUNT(*) FROM addresses) as addresses,
  (SELECT COUNT(*) FROM erc20_tokens) as erc20_tokens,
  (SELECT COUNT(*) FROM erc721_tokens) as erc721_tokens,
  (SELECT COUNT(*) FROM erc20_transfers) as erc20_transfers,
  (SELECT COUNT(*) FROM erc721_transfers) as erc721_transfers;

-- ============================================
-- ADVANCED QUERIES
-- ============================================

-- Find potential token airdrops (many transfers from one address)
SELECT
  from_address as airdrop_address,
  token_address,
  COUNT(DISTINCT to_address) as recipient_count,
  COUNT(*) as transfer_count
FROM erc20_transfers
GROUP BY from_address, token_address
HAVING recipient_count > 10
ORDER BY recipient_count DESC;

-- Find smart contract interactions (contracts calling other contracts)
SELECT
  t.from_address,
  t.to_address,
  COUNT(*) as interaction_count
FROM transactions t
WHERE t.from_address IN (SELECT address FROM contracts)
  AND t.to_address IN (SELECT address FROM contracts)
GROUP BY t.from_address, t.to_address
ORDER BY interaction_count DESC;

-- Find addresses that deployed multiple tokens
SELECT
  c.creator_address,
  COUNT(*) as token_count,
  GROUP_CONCAT(DISTINCT e.symbol) as tokens
FROM contracts c
INNER JOIN erc20_tokens e ON c.address = e.address
GROUP BY c.creator_address
HAVING token_count > 1
ORDER BY token_count DESC;

-- Block time distribution
SELECT
  ROUND(AVG(timestamp - LAG(timestamp) OVER (ORDER BY number)), 2) as avg_block_time_seconds
FROM blocks
LIMIT 1000;
