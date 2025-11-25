-- Event/Log Queries for Monad Indexer

-- ============================================
-- EVENT STATISTICS
-- ============================================

-- Total events and decoded events
SELECT
  COUNT(*) as total_events,
  SUM(CASE WHEN event_name IS NOT NULL THEN 1 ELSE 0 END) as decoded_events,
  ROUND(SUM(CASE WHEN event_name IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as decode_rate
FROM logs;

-- Top 20 events by name
SELECT
  event_name,
  event_standard,
  COUNT(*) as count
FROM logs
WHERE event_name IS NOT NULL
GROUP BY event_name, event_standard
ORDER BY count DESC
LIMIT 20;

-- Events by standard
SELECT
  event_standard,
  COUNT(*) as count,
  COUNT(DISTINCT address) as unique_contracts
FROM logs
WHERE event_standard IS NOT NULL
GROUP BY event_standard
ORDER BY count DESC;

-- ============================================
-- TRANSFER EVENTS
-- ============================================

-- Recent ERC20 Transfer events (decoded)
SELECT
  l.block_number,
  l.transaction_hash,
  l.address as token,
  json_extract(l.decoded_params, '$.from') as from_address,
  json_extract(l.decoded_params, '$.to') as to_address,
  json_extract(l.decoded_params, '$.value') as value
FROM logs l
WHERE l.event_name = 'Transfer'
  AND l.event_standard LIKE '%ERC20%'
ORDER BY l.block_number DESC
LIMIT 50;

-- Transfer volume by token
SELECT
  l.address as token,
  e.symbol,
  COUNT(*) as transfer_count,
  COUNT(DISTINCT json_extract(l.decoded_params, '$.from')) as unique_senders,
  COUNT(DISTINCT json_extract(l.decoded_params, '$.to')) as unique_receivers
FROM logs l
LEFT JOIN erc20_tokens e ON l.address = e.address
WHERE l.event_name = 'Transfer'
  AND l.event_standard LIKE '%ERC20%'
GROUP BY l.address
ORDER BY transfer_count DESC
LIMIT 20;

-- Recent NFT Transfers
SELECT
  l.block_number,
  l.address as nft_contract,
  json_extract(l.decoded_params, '$.from') as from_address,
  json_extract(l.decoded_params, '$.to') as to_address,
  json_extract(l.decoded_params, '$.value') as token_id
FROM logs l
WHERE l.event_name = 'Transfer'
  AND l.event_standard = 'ERC721'
ORDER BY l.block_number DESC
LIMIT 30;

-- ============================================
-- APPROVAL EVENTS
-- ============================================

-- Recent Approval events
SELECT
  l.block_number,
  l.address as token,
  json_extract(l.decoded_params, '$.owner') as owner,
  json_extract(l.decoded_params, '$.spender') as spender,
  json_extract(l.decoded_params, '$.value') as amount
FROM logs l
WHERE l.event_name = 'Approval'
ORDER BY l.block_number DESC
LIMIT 50;

-- ApprovalForAll events (NFTs)
SELECT
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.owner') as owner,
  json_extract(l.decoded_params, '$.operator') as operator,
  json_extract(l.decoded_params, '$.approved') as approved
FROM logs l
WHERE l.event_name = 'ApprovalForAll'
ORDER BY l.block_number DESC
LIMIT 30;

-- ============================================
-- DEX EVENTS (Uniswap-style)
-- ============================================

-- Recent Swap events
SELECT
  l.block_number,
  l.transaction_hash,
  l.address as dex_pair,
  json_extract(l.decoded_params, '$.sender') as sender,
  json_extract(l.decoded_params, '$.to') as recipient,
  json_extract(l.decoded_params, '$.amount0In') as amount0_in,
  json_extract(l.decoded_params, '$.amount1In') as amount1_in,
  json_extract(l.decoded_params, '$.amount0Out') as amount0_out,
  json_extract(l.decoded_params, '$.amount1Out') as amount1_out
FROM logs l
WHERE l.event_name = 'Swap'
ORDER BY l.block_number DESC
LIMIT 50;

-- Swap volume by DEX
SELECT
  l.address as dex_pair,
  COUNT(*) as swap_count,
  COUNT(DISTINCT l.transaction_hash) as unique_txs,
  COUNT(DISTINCT json_extract(l.decoded_params, '$.sender')) as unique_traders
FROM logs l
WHERE l.event_name = 'Swap'
GROUP BY l.address
ORDER BY swap_count DESC
LIMIT 20;

-- Liquidity events (Mint/Burn)
SELECT
  l.event_name,
  l.block_number,
  l.address as pool,
  json_extract(l.decoded_params, '$.sender') as sender,
  json_extract(l.decoded_params, '$.amount0') as amount0,
  json_extract(l.decoded_params, '$.amount1') as amount1
FROM logs l
WHERE l.event_name IN ('Mint', 'Burn')
  AND l.event_standard = 'UniswapV2'
ORDER BY l.block_number DESC
LIMIT 30;

-- ============================================
-- GOVERNANCE/OWNERSHIP EVENTS
-- ============================================

-- Ownership transfers
SELECT
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.previousOwner') as previous_owner,
  json_extract(l.decoded_params, '$.newOwner') as new_owner
FROM logs l
WHERE l.event_name = 'OwnershipTransferred'
ORDER BY l.block_number DESC
LIMIT 50;

-- Role granted/revoked events
SELECT
  l.event_name,
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.role') as role,
  json_extract(l.decoded_params, '$.account') as account,
  json_extract(l.decoded_params, '$.sender') as sender
FROM logs l
WHERE l.event_name IN ('RoleGranted', 'RoleRevoked')
ORDER BY l.block_number DESC
LIMIT 30;

-- Pause/Unpause events
SELECT
  l.event_name,
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.account') as account
FROM logs l
WHERE l.event_name IN ('Paused', 'Unpaused')
ORDER BY l.block_number DESC;

-- ============================================
-- ERC1155 EVENTS
-- ============================================

-- TransferSingle events
SELECT
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.operator') as operator,
  json_extract(l.decoded_params, '$.from') as from_address,
  json_extract(l.decoded_params, '$.to') as to_address,
  json_extract(l.decoded_params, '$.id') as token_id,
  json_extract(l.decoded_params, '$.value') as value
FROM logs l
WHERE l.event_name = 'TransferSingle'
ORDER BY l.block_number DESC
LIMIT 30;

-- TransferBatch events
SELECT
  l.block_number,
  l.address as contract,
  json_extract(l.decoded_params, '$.operator') as operator,
  json_extract(l.decoded_params, '$.from') as from_address,
  json_extract(l.decoded_params, '$.to') as to_address,
  json_extract(l.decoded_params, '$.ids') as token_ids,
  json_extract(l.decoded_params, '$.values') as values
FROM logs l
WHERE l.event_name = 'TransferBatch'
ORDER BY l.block_number DESC
LIMIT 20;

-- ============================================
-- CONTRACT ACTIVITY BY EVENT TYPE
-- ============================================

-- Most active contracts by event count
SELECT
  l.address as contract,
  COUNT(*) as total_events,
  COUNT(DISTINCT l.event_name) as unique_event_types,
  GROUP_CONCAT(DISTINCT l.event_name) as event_types
FROM logs l
WHERE l.event_name IS NOT NULL
GROUP BY l.address
ORDER BY total_events DESC
LIMIT 20;

-- Events per block (activity level)
SELECT
  l.block_number,
  COUNT(*) as event_count,
  COUNT(DISTINCT l.event_name) as unique_events,
  COUNT(DISTINCT l.address) as unique_contracts
FROM logs l
WHERE l.event_name IS NOT NULL
GROUP BY l.block_number
ORDER BY event_count DESC
LIMIT 20;

-- ============================================
-- EVENT TIMELINE ANALYSIS
-- ============================================

-- Events over time (by block range)
SELECT
  CAST(l.block_number / 10000 AS INTEGER) * 10000 as block_range,
  COUNT(*) as total_events,
  COUNT(DISTINCT l.event_name) as unique_event_types
FROM logs l
WHERE l.event_name IS NOT NULL
GROUP BY block_range
ORDER BY block_range DESC
LIMIT 50;

-- Event type distribution per contract
SELECT
  l.address as contract,
  l.event_name,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY l.address), 2) as percentage
FROM logs l
WHERE l.event_name IS NOT NULL
  AND l.address IN (
    SELECT address
    FROM logs
    WHERE event_name IS NOT NULL
    GROUP BY address
    ORDER BY COUNT(*) DESC
    LIMIT 10
  )
GROUP BY l.address, l.event_name
ORDER BY l.address, count DESC;

-- ============================================
-- SPECIFIC TOKEN ANALYSIS
-- ============================================

-- All events for a specific token
-- Replace '0x...' with actual token address
SELECT
  l.block_number,
  l.event_name,
  l.transaction_hash,
  l.decoded_params
FROM logs l
WHERE l.address = '0x...'
  AND l.event_name IS NOT NULL
ORDER BY l.block_number DESC;

-- Transfer patterns for a specific address
-- Replace '0x...' with actual address
SELECT
  l.block_number,
  l.address as token,
  CASE
    WHEN json_extract(l.decoded_params, '$.from') = '0x...' THEN 'OUT'
    WHEN json_extract(l.decoded_params, '$.to') = '0x...' THEN 'IN'
  END as direction,
  CASE
    WHEN json_extract(l.decoded_params, '$.from') = '0x...' THEN json_extract(l.decoded_params, '$.to')
    ELSE json_extract(l.decoded_params, '$.from')
  END as counterparty,
  json_extract(l.decoded_params, '$.value') as value
FROM logs l
WHERE l.event_name = 'Transfer'
  AND (
    json_extract(l.decoded_params, '$.from') = '0x...'
    OR json_extract(l.decoded_params, '$.to') = '0x...'
  )
ORDER BY l.block_number DESC
LIMIT 100;

-- ============================================
-- UNKNOWN/UNDECODED EVENTS
-- ============================================

-- Most common unknown event signatures
SELECT
  l.topic0,
  COUNT(*) as count,
  COUNT(DISTINCT l.address) as unique_contracts
FROM logs l
WHERE l.event_name IS NULL
  AND l.topic0 IS NOT NULL
GROUP BY l.topic0
ORDER BY count DESC
LIMIT 50;

-- Contracts with most undecoded events
SELECT
  l.address as contract,
  COUNT(*) as undecoded_count,
  COUNT(DISTINCT l.topic0) as unique_signatures
FROM logs l
WHERE l.event_name IS NULL
GROUP BY l.address
ORDER BY undecoded_count DESC
LIMIT 20;
