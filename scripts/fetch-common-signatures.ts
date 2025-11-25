/**
 * Fetch common event signatures from 4byte.directory and other sources
 * Adds standard DeFi events (Swap, Sync, PairCreated, etc.)
 */

import { Pool } from 'pg';
import { CONFIG } from '../src/config';
import https from 'https';

// Common DeFi event signatures - pre-computed
const COMMON_EVENTS: Record<string, { name: string; signature: string }> = {
  // Uniswap V2 / DEX
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': {
    name: 'Swap',
    signature: 'Swap(address,uint256,uint256,uint256,uint256,address)',
  },
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': {
    name: 'Sync',
    signature: 'Sync(uint112,uint112)',
  },
  '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9': {
    name: 'PairCreated',
    signature: 'PairCreated(address,address,address,uint256)',
  },
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': {
    name: 'Mint',
    signature: 'Mint(address,uint256,uint256)',
  },
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496': {
    name: 'Burn',
    signature: 'Burn(address,uint256,uint256,address)',
  },

  // Uniswap V3
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': {
    name: 'Swap',
    signature: 'Swap(address,address,int256,int256,uint160,uint128,int24)',
  },
  '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde': {
    name: 'Mint',
    signature: 'Mint(address,address,int24,int24,uint128,uint256,uint256)',
  },
  '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c': {
    name: 'Burn',
    signature: 'Burn(address,int24,int24,uint128,uint256,uint256)',
  },

  // ERC20 standard
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': {
    name: 'Transfer',
    signature: 'Transfer(address,address,uint256)',
  },
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b3ef': {
    name: 'Approval',
    signature: 'Approval(address,address,uint256)',
  },

  // ERC721
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': {
    name: 'TransferSingle',
    signature: 'TransferSingle(address,address,address,uint256,uint256)',
  },
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': {
    name: 'TransferBatch',
    signature: 'TransferBatch(address,address,address,uint256[],uint256[])',
  },

  // Wrapped tokens
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': {
    name: 'Deposit',
    signature: 'Deposit(address,uint256)',
  },
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': {
    name: 'Withdrawal',
    signature: 'Withdrawal(address,uint256)',
  },

  // Common protocols
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31': {
    name: 'ApprovalForAll',
    signature: 'ApprovalForAll(address,address,bool)',
  },
};

async function fetchFrom4byte(topicHash: string): Promise<{ name: string; signature: string } | null> {
  return new Promise((resolve) => {
    const url = `https://www.4byte.directory/api/v1/event-signatures/?hex_signature=${topicHash}`;

    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.results && json.results.length > 0) {
            const sig = json.results[0].text_signature;
            const name = sig.split('(')[0];
            resolve({ name, signature: sig });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function main() {
  console.log('=== Fetch Common Event Signatures ===\n');

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
    max: 3,
  });

  try {
    // 1. Add common events
    console.log('1. Adding common DeFi event signatures...\n');
    let added = 0;
    let skipped = 0;

    for (const [selector, event] of Object.entries(COMMON_EVENTS)) {
      const exists = await pool.query(
        'SELECT 1 FROM function_signatures WHERE selector = $1',
        [selector]
      );

      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO function_signatures (selector, name, signature, type, inputs, outputs, source_contract, source_file)
           VALUES ($1, $2, $3, 'event', '[]', '[]', 'Common', 'common-signatures')`,
          [selector, event.name, event.signature]
        );
        console.log(`   ✓ ${event.name}: ${selector.slice(0, 18)}...`);
        added++;
      } else {
        skipped++;
      }
    }

    console.log(`\n   Added: ${added}, Skipped: ${skipped}\n`);

    // 2. Get top unknown signatures from logs
    console.log('2. Fetching top unknown signatures from 4byte.directory...\n');

    const unknown = await pool.query(`
      SELECT topic0, COUNT(*) as cnt
      FROM logs
      WHERE topic0 IS NOT NULL AND event_name IS NULL
      GROUP BY topic0
      ORDER BY cnt DESC
      LIMIT 20
    `);

    let fetched = 0;
    let notFound = 0;

    for (const row of unknown.rows) {
      const topic = row.topic0;
      const count = parseInt(row.cnt);

      // Check if already in our common list or DB
      const exists = await pool.query(
        'SELECT 1 FROM function_signatures WHERE selector = $1',
        [topic]
      );

      if (exists.rows.length > 0) {
        continue;
      }

      process.stdout.write(`   ${topic.slice(0, 18)}... (${count.toLocaleString()} logs): `);

      const sig = await fetchFrom4byte(topic);
      if (sig) {
        await pool.query(
          `INSERT INTO function_signatures (selector, name, signature, type, inputs, outputs, source_contract, source_file)
           VALUES ($1, $2, $3, 'event', '[]', '[]', '4byte', '4byte.directory')
           ON CONFLICT DO NOTHING`,
          [topic, sig.name, sig.signature]
        );
        console.log(`${sig.name}`);
        fetched++;
      } else {
        console.log('not found');
        notFound++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n   Fetched: ${fetched}, Not found: ${notFound}\n`);

    // 3. Show final count
    const total = await pool.query(
      "SELECT COUNT(*) as total FROM function_signatures WHERE type = 'event'"
    );
    console.log(`Total event signatures: ${total.rows[0].total}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
