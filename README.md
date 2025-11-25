# 🚀 Monad Blockchain Indexer

A high-performance EVM indexer for the Monad blockchain. Index blocks, transactions, logs, contracts, and tokens with support for both SQLite and PostgreSQL databases.

## ✨ Features

- **High-Performance Indexing** - Fast parallel processing with configurable batch sizes
- **Dual Database Support** - Choose between SQLite (local) or PostgreSQL (production)
- **Token Detection** - Automatic detection and indexing of ERC20, ERC721, and ERC1155 tokens
- **Event Decoding** - Built-in event decoder for common protocols (Uniswap, Kuru, etc.)
- **Real-time Dashboard** - CLI dashboard showing indexing progress and statistics
- **Checkpoint System** - Resume indexing from where you left off
- **Multi-threaded** - Leverages worker threads for parallel block processing

## 📋 Requirements

- Node.js 18+ 
- npm or yarn
- PostgreSQL (optional, for production use)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/zortos293/moggi_indexer_live.git
   cd moggi_indexer_live
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment** (optional)
   
   Create a `.env` file in the root directory:
   ```env
   # RPC Configuration
   RPC_URL=https://rpc-mainnet.monadinfra.com/rpc/YOUR_API_KEY
   WS_URL=wss://rpc-mainnet.monadinfra.com/rpc/YOUR_API_KEY
   
   # Database Type: 'sqlite' or 'postgres'
   DB_TYPE=sqlite
   
   # SQLite Configuration (if DB_TYPE=sqlite)
   DB_PATH=./monad.db
   
   # PostgreSQL Configuration (if DB_TYPE=postgres)
   PG_HOST=localhost
   PG_PORT=5432
   PG_DATABASE=monad_indexer
   PG_USER=postgres
   PG_PASSWORD=your_password
   PG_MAX_CONNECTIONS=3
   
   # Performance Settings
   WORKER_THREADS=4
   BATCH_SIZE=50
   FAST_BLOCKS_PER_BATCH=100
   FAST_PARALLEL_REQUESTS=20
   ```

## 🚀 Quick Start

### Using SQLite (Recommended for Testing)

1. **Initialize the database**
   ```bash
   npm run db:init
   ```

2. **Start indexing**
   ```bash
   npm run fast
   ```

### Using PostgreSQL (Recommended for Production)

1. **Create PostgreSQL database**
   ```bash
   createdb monad_indexer
   ```

2. **Set environment variables**
   ```bash
   export DB_TYPE=postgres
   export PG_HOST=localhost
   export PG_DATABASE=monad_indexer
   export PG_USER=your_username
   export PG_PASSWORD=your_password
   ```

3. **Initialize schema**
   ```bash
   npm run db:schema
   ```

4. **Start indexing**
   ```bash
   npm run fast
   ```

## 📖 Usage

### Main Indexing Commands

| Command | Description |
|---------|-------------|
| `npm run fast` | Start fast indexer (recommended) |
| `npm start` | Start standard indexer |
| `npm run dev` | Build and start in development mode |

### Database Management

| Command | Description |
|---------|-------------|
| `npm run db:init` | Initialize SQLite database |
| `npm run db:schema` | Create database schema (PostgreSQL) |
| `npm run db:reset` | Reset database keeping schema |
| `npm run db:fresh` | Drop and recreate database |

### CLI Tools

| Command | Description |
|---------|-------------|
| `npm run cli` | Interactive CLI for SQLite |
| `npm run cli:pg` | Interactive CLI for PostgreSQL |
| `npm run events` | Query and analyze events |
| `npm run list:protocols` | List indexed protocols |
| `npm run query:contract` | Query specific contract |

### Migration Tools

| Command | Description |
|---------|-------------|
| `npm run migrate:postgres` | Migrate SQLite to PostgreSQL |
| `npm run migrate:planetscale` | Migrate to PlanetScale |

### Utility Scripts

| Command | Description |
|---------|-------------|
| `npm run fix:nft` | Fix NFT detection |
| `npm run backfill:nft` | Backfill NFT transfers |
| `npm run decode:logs` | Decode historical logs |
| `npm run import:protocols` | Import protocol metadata |

## ⚙️ Configuration

### Environment Variables

**RPC Settings**
- `RPC_URL` - Monad RPC endpoint (required)
- `WS_URL` - WebSocket endpoint (optional)
- `RPC_TIMEOUT` - Request timeout in ms (default: 60000)

**Database Settings**
- `DB_TYPE` - Database type: `sqlite` or `postgres` (default: `postgres`)
- `DB_PATH` - SQLite database path (default: `./monad.db`)
- `PG_HOST` - PostgreSQL host (default: `localhost`)
- `PG_PORT` - PostgreSQL port (default: `5432`)
- `PG_DATABASE` - PostgreSQL database name
- `PG_USER` - PostgreSQL username
- `PG_PASSWORD` - PostgreSQL password
- `PG_MAX_CONNECTIONS` - Max connections (default: `3`)

**Performance Settings**
- `WORKER_THREADS` - Number of worker threads (default: `4`)
- `BATCH_SIZE` - Blocks per parallel batch (default: `50`)
- `FAST_BLOCKS_PER_BATCH` - Blocks per RPC batch call (default: `100`)
- `FAST_PARALLEL_REQUESTS` - Parallel RPC requests (default: `20`)
- `FAST_DB_WRITE_INTERVAL` - DB write queue batch size (default: `100`)

## 📊 What Gets Indexed

### Core Data
- **Blocks** - All block headers and metadata
- **Transactions** - All transactions with receipts
- **Logs** - Event logs with automatic decoding
- **Contracts** - Deployed contracts with creation info

### Token Standards
- **ERC20 Tokens** - Name, symbol, decimals, supply
- **ERC721 NFTs** - Name, symbol, metadata
- **ERC1155 Multi-Tokens** - URI and metadata

### Transfers
- **ERC20 Transfers** - All token transfers
- **ERC721 Transfers** - All NFT transfers
- **Native Transfers** - ETH/MON transfers

### Addresses
- **Address Registry** - All active addresses
- **Address Transactions** - Transaction history per address
- **Contract Detection** - Automatic EOA vs Contract detection

## 🔍 Querying Data

### Using SQLite

```bash
npm run cli
```

Example queries:
```sql
-- Get latest blocks
SELECT * FROM blocks ORDER BY number DESC LIMIT 10;

-- Get ERC20 tokens
SELECT * FROM erc20_tokens;

-- Get recent transfers
SELECT * FROM erc20_transfers ORDER BY block_number DESC LIMIT 100;

-- Get transactions for an address
SELECT * FROM address_transactions WHERE address = '0x...';
```

### Using PostgreSQL

```bash
npm run cli:pg
```

Or connect with any PostgreSQL client:
```bash
psql -h localhost -U postgres -d monad_indexer
```

## 🎯 Performance

The fast indexer can process **2,000+ blocks per request cycle** with optimized settings:

- **Parallel Processing**: 20 concurrent RPC requests
- **Batch Processing**: 100 blocks per batch
- **Background Writing**: Non-blocking database writes
- **Checkpoint System**: Automatic progress saving

### Optimization Tips

1. **For SQLite**: Use SSD storage and increase `DB_BATCH_INSERT_SIZE`
2. **For PostgreSQL**: Increase `PG_MAX_CONNECTIONS` and use connection pooling
3. **Network**: Use a reliable RPC endpoint with high rate limits
4. **System**: Allocate more CPU cores with `WORKER_THREADS`

## 🐛 Troubleshooting

### Database locked (SQLite)
```bash
# Reset the database
npm run db:reset
```

### Connection pool exhausted (PostgreSQL)
```bash
# Reduce parallel requests
export FAST_PARALLEL_REQUESTS=5
export WORKER_THREADS=2
```

### RPC timeout errors
```bash
# Increase timeout
export RPC_TIMEOUT=120000
```

### Missing events
```bash
# Re-decode existing logs
npm run decode:logs
```

## 📁 Project Structure

```
moggi_indexer_live/
├── src/
│   ├── index.ts              # Standard indexer entry
│   ├── fast-index.ts         # Fast indexer entry (recommended)
│   ├── fast-indexer.ts       # Fast indexer implementation
│   ├── indexer.ts            # Standard indexer implementation
│   ├── rpc-client.ts         # RPC client with batching
│   ├── database.ts           # SQLite database manager
│   ├── database-pg.ts        # PostgreSQL database manager
│   ├── event-decoder.ts      # Event decoding logic
│   ├── token-detector.ts     # Token standard detection
│   ├── cli-dashboard.ts      # Real-time dashboard
│   └── types.ts              # TypeScript types
├── scripts/                  # Utility scripts
├── abi/                      # Contract ABIs
├── schema.sql               # SQLite schema
├── schema-postgres.sql      # PostgreSQL schema
└── package.json
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📄 License

MIT License - feel free to use this project for any purpose.

## 🔗 Resources

- [Monad Documentation](https://docs.monad.xyz/)
- [Monad RPC Endpoints](https://monad.xyz/rpc)

## 💡 Tips

- Start with SQLite for testing, migrate to PostgreSQL for production
- Use the fast indexer (`npm run fast`) for best performance
- Monitor the CLI dashboard for real-time progress
- Enable token detection for comprehensive indexing
- Set up checkpoints to resume after interruptions

---

Built with ❤️ for the Monad ecosystem

