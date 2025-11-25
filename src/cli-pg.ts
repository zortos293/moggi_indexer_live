import { Pool } from 'pg';
import { CONFIG } from './config';

// Simple CLI for querying the PostgreSQL database
const pool = new Pool({
  host: CONFIG.PG_HOST,
  port: CONFIG.PG_PORT,
  database: CONFIG.PG_DATABASE,
  user: CONFIG.PG_USER,
  password: CONFIG.PG_PASSWORD,
  ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  max: 1,
});

const command = process.argv[2];

async function main() {
  try {
    switch (command) {
      case 'stats':
        await showStats();
        break;
      case 'blocks':
        await showRecentBlocks(parseInt(process.argv[3]) || 10);
        break;
      case 'contracts':
        await showRecentContracts(parseInt(process.argv[3]) || 10);
        break;
      case 'tokens':
        await showTokens();
        break;
      case 'tx':
        if (process.argv[3]) {
          await showTransaction(process.argv[3]);
        } else {
          console.log('Usage: npm run cli:pg tx <transaction_hash>');
        }
        break;
      case 'address':
        if (process.argv[3]) {
          await showAddress(process.argv[3]);
        } else {
          console.log('Usage: npm run cli:pg address <address>');
        }
        break;
      default:
        console.log(`
Monad Indexer CLI (PostgreSQL)

Commands:
  stats                    - Show indexer statistics
  blocks [limit]          - Show recent blocks (default: 10)
  contracts [limit]       - Show recent contracts (default: 10)
  tokens                  - Show all tokens
  tx <hash>              - Show transaction details
  address <addr>         - Show address details

Example:
  npm run cli:pg stats
  npm run cli:pg blocks 20
  npm run cli:pg tx 0x123...
`);
    }
  } finally {
    await pool.end();
  }
}

async function showStats() {
  const client = await pool.connect();
  try {
    const [blocks, txs, contracts, erc20, erc721, state] = await Promise.all([
      client.query('SELECT COUNT(*) as count FROM blocks'),
      client.query('SELECT COUNT(*) as count FROM transactions'),
      client.query('SELECT COUNT(*) as count FROM contracts'),
      client.query('SELECT COUNT(*) as count FROM erc20_tokens'),
      client.query('SELECT COUNT(*) as count FROM erc721_tokens'),
      client.query('SELECT * FROM indexer_state WHERE id = 1'),
    ]);

    console.log('\n📊 Indexer Statistics');
    console.log('='.repeat(50));
    console.log(`Blocks indexed:     ${parseInt(blocks.rows[0].count).toLocaleString()}`);
    console.log(`Transactions:       ${parseInt(txs.rows[0].count).toLocaleString()}`);
    console.log(`Contracts:          ${parseInt(contracts.rows[0].count).toLocaleString()}`);
    console.log(`ERC20 Tokens:       ${parseInt(erc20.rows[0].count).toLocaleString()}`);
    console.log(`ERC721 Tokens:      ${parseInt(erc721.rows[0].count).toLocaleString()}`);
    console.log('');

    if (state.rows[0]) {
      const s = state.rows[0];
      console.log('📈 Indexer State');
      console.log('='.repeat(50));
      console.log(`Forward Block:      ${s.forward_block?.toLocaleString() || 'N/A'}`);
      console.log(`Backward Block:     ${s.backward_block?.toLocaleString() || 'N/A'}`);
      console.log(`Latest Block:       ${s.latest_block?.toLocaleString() || 'N/A'}`);
      console.log(`Is Synced:          ${s.is_synced === 1 ? 'Yes' : 'No'}`);
      console.log(`Last Updated:       ${new Date(s.last_updated * 1000).toLocaleString()}`);
    }
  } finally {
    client.release();
  }
}

async function showRecentBlocks(limit: number) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT number, hash, timestamp, transaction_count, miner FROM blocks ORDER BY number DESC LIMIT $1',
      [limit]
    );

    console.log(`\n📦 Recent Blocks (${limit})`);
    console.log('='.repeat(100));
    console.log(
      'Block'.padEnd(12) +
      'Hash'.padEnd(20) +
      'Timestamp'.padEnd(22) +
      'TXs'.padEnd(8) +
      'Miner'
    );
    console.log('-'.repeat(100));

    for (const block of result.rows) {
      const timestamp = new Date(block.timestamp * 1000).toLocaleString();
      console.log(
        block.number.toString().padEnd(12) +
        (block.hash.slice(0, 18) + '...').padEnd(20) +
        timestamp.padEnd(22) +
        block.transaction_count.toString().padEnd(8) +
        (block.miner.slice(0, 20) + '...')
      );
    }
  } finally {
    client.release();
  }
}

async function showRecentContracts(limit: number) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        c.address, c.creation_block_number, c.creator_address,
        c.is_erc20, c.is_erc721, c.is_erc1155,
        e20.name as erc20_name, e20.symbol as erc20_symbol,
        e721.name as erc721_name, e721.symbol as erc721_symbol
      FROM contracts c
      LEFT JOIN erc20_tokens e20 ON c.address = e20.address
      LEFT JOIN erc721_tokens e721 ON c.address = e721.address
      ORDER BY c.creation_block_number DESC
      LIMIT $1`,
      [limit]
    );

    console.log(`\n📝 Recent Contracts (${limit})`);
    console.log('='.repeat(120));
    console.log(
      'Block'.padEnd(10) +
      'Address'.padEnd(45) +
      'Type'.padEnd(15) +
      'Name'.padEnd(25) +
      'Symbol'
    );
    console.log('-'.repeat(120));

    for (const c of result.rows) {
      let type = 'Unknown';
      let name = '';
      let symbol = '';

      if (c.is_erc20 === 1) {
        type = 'ERC20';
        name = c.erc20_name || '';
        symbol = c.erc20_symbol || '';
      } else if (c.is_erc721 === 1) {
        type = 'ERC721';
        name = c.erc721_name || '';
        symbol = c.erc721_symbol || '';
      } else if (c.is_erc1155 === 1) {
        type = 'ERC1155';
      }

      console.log(
        c.creation_block_number.toString().padEnd(10) +
        c.address.padEnd(45) +
        type.padEnd(15) +
        (name || '').slice(0, 24).padEnd(25) +
        (symbol || '').slice(0, 10)
      );
    }
  } finally {
    client.release();
  }
}

async function showTokens() {
  const client = await pool.connect();
  try {
    const erc20 = await client.query(
      'SELECT address, name, symbol, decimals FROM erc20_tokens ORDER BY indexed_at DESC LIMIT 50'
    );

    const erc721 = await client.query(
      'SELECT address, name, symbol FROM erc721_tokens ORDER BY indexed_at DESC LIMIT 50'
    );

    console.log('\n🪙 ERC20 Tokens');
    console.log('='.repeat(100));
    console.log('Address'.padEnd(45) + 'Name'.padEnd(30) + 'Symbol'.padEnd(12) + 'Decimals');
    console.log('-'.repeat(100));

    for (const token of erc20.rows) {
      console.log(
        token.address.padEnd(45) +
        (token.name || '').slice(0, 28).padEnd(30) +
        (token.symbol || '').slice(0, 10).padEnd(12) +
        (token.decimals || 'N/A')
      );
    }

    console.log('\n🎨 ERC721 Tokens');
    console.log('='.repeat(100));
    console.log('Address'.padEnd(45) + 'Name'.padEnd(30) + 'Symbol');
    console.log('-'.repeat(100));

    for (const token of erc721.rows) {
      console.log(
        token.address.padEnd(45) +
        (token.name || '').slice(0, 28).padEnd(30) +
        (token.symbol || '').slice(0, 10)
      );
    }
  } finally {
    client.release();
  }
}

async function showTransaction(hash: string) {
  const client = await pool.connect();
  try {
    const txResult = await client.query('SELECT * FROM transactions WHERE hash = $1', [hash.toLowerCase()]);

    if (txResult.rows.length === 0) {
      console.log(`Transaction ${hash} not found`);
      return;
    }

    const tx = txResult.rows[0];

    console.log('\n📄 Transaction Details');
    console.log('='.repeat(80));
    console.log(`Hash:           ${tx.hash}`);
    console.log(`Block:          ${tx.block_number}`);
    console.log(`Index:          ${tx.transaction_index}`);
    console.log(`From:           ${tx.from_address}`);
    console.log(`To:             ${tx.to_address || 'Contract Creation'}`);
    console.log(`Value:          ${tx.value} wei`);
    console.log(`Gas Used:       ${tx.gas_used?.toLocaleString() || 'N/A'}`);
    console.log(`Gas Price:      ${tx.gas_price || 'N/A'}`);
    console.log(`Status:         ${tx.status === 1 ? '✅ Success' : '❌ Failed'}`);
    console.log(`Type:           ${tx.type}`);
    console.log(`Nonce:          ${tx.nonce}`);

    if (tx.contract_address) {
      console.log(`Contract:       ${tx.contract_address}`);
    }

    // Show logs count
    console.log(`Logs:           ${tx.logs_count}`);

    // Show recent logs
    if (tx.logs_count > 0) {
      const logsResult = await client.query(
        'SELECT * FROM logs WHERE transaction_hash = $1 ORDER BY log_index LIMIT 10',
        [hash.toLowerCase()]
      );

      console.log('\n📋 Events:');
      console.log('-'.repeat(80));

      for (const log of logsResult.rows) {
        console.log(`  [${log.log_index}] ${log.event_name || 'Unknown'} @ ${log.address.slice(0, 20)}...`);
        if (log.event_standard) {
          console.log(`       Standard: ${log.event_standard}`);
        }
      }
    }
  } finally {
    client.release();
  }
}

async function showAddress(address: string) {
  const client = await pool.connect();
  try {
    const addrResult = await client.query('SELECT * FROM addresses WHERE address = $1', [address.toLowerCase()]);

    if (addrResult.rows.length === 0) {
      console.log(`Address ${address} not found`);
      return;
    }

    const addr = addrResult.rows[0];

    console.log('\n📍 Address Details');
    console.log('='.repeat(80));
    console.log(`Address:        ${addr.address}`);
    console.log(`Is Contract:    ${addr.is_contract === 1 ? 'Yes' : 'No'}`);
    console.log(`First Seen:     Block ${addr.first_seen_block}`);
    console.log(`TX Count:       ${addr.tx_count}`);

    // Show recent transactions
    const txsResult = await client.query(
      `SELECT at.*, t.value, t.status
       FROM address_transactions at
       JOIN transactions t ON at.transaction_hash = t.hash
       WHERE at.address = $1
       ORDER BY at.block_number DESC
       LIMIT 10`,
      [address.toLowerCase()]
    );

    console.log('\n📜 Recent Transactions:');
    console.log('-'.repeat(80));

    for (const tx of txsResult.rows) {
      const direction = tx.is_from === 1 ? 'OUT' : 'IN';
      const status = tx.status === 1 ? '✅' : '❌';
      console.log(
        `  ${status} [${direction}] Block ${tx.block_number}: ${tx.transaction_hash.slice(0, 30)}...`
      );
    }

    // If contract, show more details
    if (addr.is_contract === 1) {
      const contractResult = await client.query('SELECT * FROM contracts WHERE address = $1', [
        address.toLowerCase(),
      ]);

      if (contractResult.rows.length > 0) {
        const c = contractResult.rows[0];
        console.log('\n🔧 Contract Details:');
        console.log('-'.repeat(80));
        console.log(`Creator:        ${c.creator_address}`);
        console.log(`Creation TX:    ${c.creation_tx_hash}`);
        console.log(`Creation Block: ${c.creation_block_number}`);

        if (c.is_erc20 === 1) {
          const tokenResult = await client.query('SELECT * FROM erc20_tokens WHERE address = $1', [
            address.toLowerCase(),
          ]);
          if (tokenResult.rows.length > 0) {
            const token = tokenResult.rows[0];
            console.log(`\nERC20 Token:`);
            console.log(`  Name:         ${token.name}`);
            console.log(`  Symbol:       ${token.symbol}`);
            console.log(`  Decimals:     ${token.decimals}`);
          }
        }

        if (c.is_erc721 === 1) {
          const tokenResult = await client.query('SELECT * FROM erc721_tokens WHERE address = $1', [
            address.toLowerCase(),
          ]);
          if (tokenResult.rows.length > 0) {
            const token = tokenResult.rows[0];
            console.log(`\nERC721 Token:`);
            console.log(`  Name:         ${token.name}`);
            console.log(`  Symbol:       ${token.symbol}`);
          }
        }
      }
    }
  } finally {
    client.release();
  }
}

main().catch(console.error);
