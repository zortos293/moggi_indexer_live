import Database from 'better-sqlite3';
import { CONFIG } from './config';

// Simple CLI for querying the database
const db = new Database(CONFIG.DB_PATH, { readonly: true });

const command = process.argv[2];

switch (command) {
  case 'stats':
    showStats();
    break;
  case 'blocks':
    showRecentBlocks(parseInt(process.argv[3]) || 10);
    break;
  case 'contracts':
    showRecentContracts(parseInt(process.argv[3]) || 10);
    break;
  case 'tokens':
    showTokens();
    break;
  case 'tx':
    if (process.argv[3]) {
      showTransaction(process.argv[3]);
    } else {
      console.log('Usage: npm run cli tx <transaction_hash>');
    }
    break;
  case 'address':
    if (process.argv[3]) {
      showAddress(process.argv[3]);
    } else {
      console.log('Usage: npm run cli address <address>');
    }
    break;
  default:
    console.log(`
Monad Indexer CLI

Commands:
  stats                    - Show indexer statistics
  blocks [limit]          - Show recent blocks (default: 10)
  contracts [limit]       - Show recent contracts (default: 10)
  tokens                  - Show all tokens
  tx <hash>              - Show transaction details
  address <addr>         - Show address details

Example:
  npm run cli stats
  npm run cli blocks 20
  npm run cli tx 0x123...
    `);
}

function showStats() {
  const state = db.prepare('SELECT * FROM indexer_state WHERE id = 1').get() as any;
  const blocks = db.prepare('SELECT COUNT(*) as count FROM blocks').get() as any;
  const txs = db.prepare('SELECT COUNT(*) as count FROM transactions').get() as any;
  const contracts = db.prepare('SELECT COUNT(*) as count FROM contracts').get() as any;
  const erc20 = db.prepare('SELECT COUNT(*) as count FROM erc20_tokens').get() as any;
  const erc721 = db.prepare('SELECT COUNT(*) as count FROM erc721_tokens').get() as any;
  const addresses = db.prepare('SELECT COUNT(*) as count FROM addresses').get() as any;

  console.log('\n📊 Indexer Statistics\n');
  console.log(`Status:          ${state.is_synced ? '✅ Synced' : '⏳ Syncing'}`);
  console.log(`Forward Block:   ${state.forward_block}`);
  console.log(`Backward Block:  ${state.backward_block || 'N/A'}`);
  console.log(`Latest Block:    ${state.latest_block || 'N/A'}`);
  console.log();
  console.log(`Blocks:          ${blocks.count.toLocaleString()}`);
  console.log(`Transactions:    ${txs.count.toLocaleString()}`);
  console.log(`Contracts:       ${contracts.count.toLocaleString()}`);
  console.log(`Addresses:       ${addresses.count.toLocaleString()}`);
  console.log(`ERC20 Tokens:    ${erc20.count.toLocaleString()}`);
  console.log(`ERC721 Tokens:   ${erc721.count.toLocaleString()}`);
  console.log();
}

function showRecentBlocks(limit: number) {
  const blocks = db
    .prepare('SELECT number, hash, miner, transaction_count, gas_used, timestamp FROM blocks ORDER BY number DESC LIMIT ?')
    .all(limit);

  console.log(`\n📦 Recent Blocks (${limit})\n`);
  console.table(blocks);
}

function showRecentContracts(limit: number) {
  const contracts = db
    .prepare(`
      SELECT
        c.address,
        c.creator_address,
        c.creation_block_number,
        c.is_erc20,
        c.is_erc721,
        c.is_erc1155,
        e20.symbol as erc20_symbol,
        e721.symbol as erc721_symbol
      FROM contracts c
      LEFT JOIN erc20_tokens e20 ON c.address = e20.address
      LEFT JOIN erc721_tokens e721 ON c.address = e721.address
      ORDER BY c.creation_block_number DESC
      LIMIT ?
    `)
    .all(limit);

  console.log(`\n📜 Recent Contracts (${limit})\n`);
  console.table(contracts);
}

function showTokens() {
  const erc20 = db.prepare('SELECT * FROM erc20_tokens ORDER BY indexed_at DESC').all();
  const erc721 = db.prepare('SELECT * FROM erc721_tokens ORDER BY indexed_at DESC').all();

  console.log(`\n🪙 ERC20 Tokens (${erc20.length})\n`);
  console.table(erc20);

  console.log(`\n🖼️  ERC721 Tokens (${erc721.length})\n`);
  console.table(erc721);
}

function showTransaction(hash: string) {
  const tx = db.prepare('SELECT * FROM transactions WHERE hash = ?').get(hash);

  if (!tx) {
    console.log(`Transaction ${hash} not found`);
    return;
  }

  console.log('\n💸 Transaction Details\n');
  console.log(tx);

  const logs = db.prepare('SELECT * FROM logs WHERE transaction_hash = ?').all(hash);
  console.log(`\n📝 Logs (${logs.length})\n`);
  console.table(logs);
}

function showAddress(address: string) {
  const addr = db.prepare('SELECT * FROM addresses WHERE address = ?').get(address.toLowerCase()) as any;

  if (!addr) {
    console.log(`Address ${address} not found`);
    return;
  }

  console.log('\n👤 Address Details\n');
  console.log(addr);

  const txs = db
    .prepare(`
      SELECT t.*
      FROM transactions t
      INNER JOIN address_transactions at ON t.hash = at.transaction_hash
      WHERE at.address = ?
      ORDER BY t.block_number DESC
      LIMIT 20
    `)
    .all(address.toLowerCase());

  console.log(`\n💸 Recent Transactions (${txs.length})\n`);
  console.table(txs);

  // Check if it's a contract
  if (addr.is_contract === 1) {
    const contract = db.prepare('SELECT * FROM contracts WHERE address = ?').get(address.toLowerCase());
    if (contract) {
      console.log('\n📜 Contract Details\n');
      console.log(contract);
    }
  }
}

db.close();
