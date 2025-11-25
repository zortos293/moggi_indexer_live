/**
 * Query contract information including protocol metadata
 *
 * Usage:
 *   npx tsx scripts/query-contract.ts <address>
 *   npx tsx scripts/query-contract.ts 0x1234...
 */

import { Pool } from 'pg';
import { CONFIG } from '../src/config';

async function main() {
  const address = process.argv[2]?.toLowerCase();

  if (!address) {
    console.log('Usage: npx tsx scripts/query-contract.ts <address>');
    process.exit(1);
  }

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  });

  try {
    // Query contract with protocol metadata
    const result = await pool.query(`
      SELECT
        c.address,
        c.bytecode_hash,
        c.is_erc20,
        c.is_erc721,
        c.is_erc1155,
        c.name as token_name,
        c.symbol as token_symbol,
        c.decimals,
        c.total_supply,
        cm.contract_name,
        cm.nickname,
        cm.notes,
        p.name as protocol_name,
        p.description as protocol_description,
        p.logo_url,
        p.website,
        p.twitter,
        p.github,
        p.docs,
        p.discord,
        p.telegram,
        p.is_live
      FROM contracts c
      LEFT JOIN contract_metadata cm ON c.address = cm.address
      LEFT JOIN protocols p ON cm.protocol_id = p.id
      WHERE c.address = $1
    `, [address]);

    if (result.rows.length === 0) {
      // Check if it exists in contract_metadata but not contracts table
      const metaOnly = await pool.query(`
        SELECT
          cm.address,
          cm.contract_name,
          cm.nickname,
          cm.notes,
          p.name as protocol_name,
          p.description as protocol_description,
          p.logo_url,
          p.website,
          p.twitter,
          p.github,
          p.docs,
          p.discord,
          p.telegram,
          p.is_live
        FROM contract_metadata cm
        LEFT JOIN protocols p ON cm.protocol_id = p.id
        WHERE cm.address = $1
      `, [address]);

      if (metaOnly.rows.length > 0) {
        console.log('\n=== Contract Metadata (not yet indexed) ===\n');
        const m = metaOnly.rows[0];
        console.log(`Address: ${m.address}`);
        if (m.contract_name) console.log(`Contract Name: ${m.contract_name}`);
        if (m.nickname) console.log(`Nickname: ${m.nickname}`);
        if (m.notes) console.log(`Notes: ${m.notes}`);

        if (m.protocol_name) {
          console.log('\n--- Protocol Info ---');
          console.log(`Protocol: ${m.protocol_name}`);
          if (m.protocol_description) console.log(`Description: ${m.protocol_description}`);
          if (m.website) console.log(`Website: ${m.website}`);
          if (m.twitter) console.log(`Twitter: ${m.twitter}`);
          if (m.github) console.log(`GitHub: ${m.github}`);
          if (m.docs) console.log(`Docs: ${m.docs}`);
          if (m.discord) console.log(`Discord: ${m.discord}`);
          if (m.telegram) console.log(`Telegram: ${m.telegram}`);
          console.log(`Live: ${m.is_live ? 'Yes' : 'No'}`);
        }
      } else {
        console.log(`Contract ${address} not found in database`);
      }
    } else {
      const c = result.rows[0];
      console.log('\n=== Contract Information ===\n');
      console.log(`Address: ${c.address}`);

      // Token info
      if (c.is_erc20 || c.is_erc721 || c.is_erc1155) {
        const types = [];
        if (c.is_erc20) types.push('ERC20');
        if (c.is_erc721) types.push('ERC721');
        if (c.is_erc1155) types.push('ERC1155');
        console.log(`Token Type: ${types.join(', ')}`);
        if (c.token_name) console.log(`Token Name: ${c.token_name}`);
        if (c.token_symbol) console.log(`Symbol: ${c.token_symbol}`);
        if (c.decimals !== null) console.log(`Decimals: ${c.decimals}`);
        if (c.total_supply) console.log(`Total Supply: ${c.total_supply}`);
      }

      // Contract metadata
      if (c.contract_name || c.nickname) {
        console.log('\n--- Contract Metadata ---');
        if (c.contract_name) console.log(`Contract Name: ${c.contract_name}`);
        if (c.nickname) console.log(`Nickname: ${c.nickname}`);
        if (c.notes) console.log(`Notes: ${c.notes}`);
      }

      // Protocol info
      if (c.protocol_name) {
        console.log('\n--- Protocol Info ---');
        console.log(`Protocol: ${c.protocol_name}`);
        if (c.protocol_description) console.log(`Description: ${c.protocol_description}`);
        if (c.logo_url) console.log(`Logo: ${c.logo_url}`);
        if (c.website) console.log(`Website: ${c.website}`);
        if (c.twitter) console.log(`Twitter: ${c.twitter}`);
        if (c.github) console.log(`GitHub: ${c.github}`);
        if (c.docs) console.log(`Docs: ${c.docs}`);
        if (c.discord) console.log(`Discord: ${c.discord}`);
        if (c.telegram) console.log(`Telegram: ${c.telegram}`);
        console.log(`Live: ${c.is_live ? 'Yes' : 'No'}`);
      } else {
        console.log('\n--- Protocol Info ---');
        console.log('No protocol metadata found for this contract');
      }
    }

    console.log('');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
