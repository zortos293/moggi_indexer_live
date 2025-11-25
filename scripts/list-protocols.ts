/**
 * List all protocols and their contracts
 *
 * Usage:
 *   npx tsx scripts/list-protocols.ts
 *   npx tsx scripts/list-protocols.ts --with-contracts
 */

import { Pool } from 'pg';
import { CONFIG } from '../src/config';

async function main() {
  const showContracts = process.argv.includes('--with-contracts');

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  });

  try {
    const protocols = await pool.query(`
      SELECT
        p.*,
        COUNT(cm.address) as contract_count
      FROM protocols p
      LEFT JOIN contract_metadata cm ON p.id = cm.protocol_id
      GROUP BY p.id
      ORDER BY p.name
    `);

    console.log(`\n=== Protocols (${protocols.rows.length} total) ===\n`);

    for (const p of protocols.rows) {
      console.log(`${p.name} (${p.contract_count} contracts)`);
      if (p.description) console.log(`  ${p.description}`);
      if (p.website) console.log(`  Web: ${p.website}`);
      if (p.twitter) console.log(`  Twitter: ${p.twitter}`);

      if (showContracts && p.contract_count > 0) {
        const contracts = await pool.query(`
          SELECT address, contract_name
          FROM contract_metadata
          WHERE protocol_id = $1
          ORDER BY contract_name
        `, [p.id]);

        for (const c of contracts.rows) {
          console.log(`    - ${c.contract_name || 'Unknown'}: ${c.address}`);
        }
      }

      console.log('');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
