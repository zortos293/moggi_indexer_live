import * as fs from 'fs';

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

// Determine RPC and WS URLs
const DEFAULT_RPC = 'https://rpc-mainnet.monadinfra.com/rpc/YOUR_API_KEY';
const RPC_URL = process.env.RPC_URL || DEFAULT_RPC;
// Attempt to auto-generate WS URL if not provided
const WS_URL = process.env.WS_URL || RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export const CONFIG = {
  // Monad Mainnet
  CHAIN_ID: 143,
  RPC_URL: RPC_URL,
  WS_URL: WS_URL,

  // Database Type: 'sqlite' or 'postgres'
  DB_TYPE: (process.env.DB_TYPE || 'postgres') as 'sqlite' | 'postgres',

  // SQLite Database (if DB_TYPE is 'sqlite')
  DB_PATH: process.env.DB_PATH || './monad.db',

  // PostgreSQL Configuration (if DB_TYPE is 'postgres')
  PG_HOST: process.env.PG_HOST || 'localhost',
  PG_PORT: parseInt(process.env.PG_PORT || '5432'),
  PG_DATABASE: process.env.PG_DATABASE || 'postgres',
  PG_USER: process.env.PG_USER || '',
  PG_PASSWORD: process.env.PG_PASSWORD || '',
  PG_SSL: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false',
  PG_MAX_CONNECTIONS: parseInt(process.env.PG_MAX_CONNECTIONS || '3'),

  // Indexing
  WORKER_THREADS: parseInt(process.env.WORKER_THREADS || '4'), // Reduced for PostgreSQL connection limits
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '50'), // Number of blocks to process in parallel
  RPC_BATCH_SIZE: 200, // Number of RPC calls to batch together
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 500, // ms
  RPC_TIMEOUT: parseInt(process.env.RPC_TIMEOUT || '60000'), // Request timeout in ms

  // Checkpointing
  CHECKPOINT_INTERVAL: 500, // Save progress every N blocks

  // Contract addresses
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11',

  // Token detection
  DETECT_TOKENS: true,

  // Performance
  DB_BATCH_INSERT_SIZE: 1000, // Insert in batches for performance

  // Fast Indexer Settings (10x faster mode)
  FAST_BLOCKS_PER_BATCH: parseInt(process.env.FAST_BLOCKS_PER_BATCH || '100'), // Blocks per RPC batch call
  FAST_PARALLEL_REQUESTS: parseInt(process.env.FAST_PARALLEL_REQUESTS || '20'), // Parallel RPC requests (20 * 100 = 2000 blocks)
  FAST_DB_WRITE_INTERVAL: parseInt(process.env.FAST_DB_WRITE_INTERVAL || '100'), // DB write queue batch size
};

// ERC20 Function Signatures
export const ERC20_SIGNATURES = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  transfer: '0xa9059cbb',
};

// ERC721 Function Signatures
export const ERC721_SIGNATURES = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  tokenURI: '0xc87b56dd',
  ownerOf: '0x6352211e',
  balanceOf: '0x70a08231',
};

// ERC1155 Function Signatures
export const ERC1155_SIGNATURES = {
  uri: '0x0e89341c',
  balanceOf: '0x00fdd58e',
  balanceOfBatch: '0x4e1273f4',
};

// Event Signatures (topics[0])
export const EVENT_SIGNATURES = {
  // ERC20
  Transfer_ERC20: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
  Approval_ERC20: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',

  // ERC721
  Transfer_ERC721: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Same as ERC20
  Approval_ERC721: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  ApprovalForAll_ERC721: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',

  // ERC1155
  TransferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  TransferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
  ApprovalForAll_ERC1155: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
};

// Interface IDs (ERC165)
export const INTERFACE_IDS = {
  ERC165: '0x01ffc9a7',
  ERC20: '0x36372b07', // Not standard but some use it
  ERC721: '0x80ac58cd',
  ERC1155: '0xd9b67a26',
  ERC721Metadata: '0x5b5e139f',
  ERC721Enumerable: '0x780e9d63',
};
