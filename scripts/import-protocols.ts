/**
 * Import protocol metadata from monad-crypto/protocols GitHub repo
 * Downloads all protocol JSONs and imports them into database
 *
 * Usage: npx tsx scripts/import-protocols.ts
 */

import { Pool } from 'pg';
import { CONFIG } from '../src/config';
import https from 'https';

const REPO_OWNER = 'monad-crypto';
const REPO_NAME = 'protocols';
const BRANCH = 'main';
const PATH = 'mainnet';

interface ProtocolData {
  name: string;
  description?: string;
  live?: boolean;
  addresses?: Record<string, string>;
  links?: {
    project?: string;
    twitter?: string;
    github?: string;
    docs?: string;
    discord?: string;
    telegram?: string;
  };
}

async function fetchFileList(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${PATH}`;

    https.get(url, {
      headers: { 'User-Agent': 'monad-indexer' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API error: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const files = JSON.parse(data);
          const jsonFiles = files
            .filter((f: any) => f.name.endsWith('.json') || f.name.endsWith('.jsonc'))
            .map((f: any) => f.name);
          resolve(jsonFiles);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchProtocolFile(filename: string): Promise<ProtocolData | null> {
  return new Promise((resolve) => {
    const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${PATH}/${filename}`;

    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Remove JSONC comments more carefully:
          // 1. Remove single-line comments (// ...) but not inside strings
          // 2. Remove multi-line comments (/* ... */)
          let cleanJson = data;

          // Remove single-line comments that are NOT inside strings
          // This regex matches // comments only when not inside a string
          cleanJson = cleanJson.split('\n').map(line => {
            // Find // that's not inside a string
            let inString = false;
            let escaped = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (escaped) {
                escaped = false;
                continue;
              }
              if (char === '\\') {
                escaped = true;
                continue;
              }
              if (char === '"' && !escaped) {
                inString = !inString;
              }
              if (!inString && char === '/' && line[i + 1] === '/') {
                return line.substring(0, i);
              }
            }
            return line;
          }).join('\n');

          // Remove multi-line comments
          cleanJson = cleanJson.replace(/\/\*[\s\S]*?\*\//g, '');

          // Remove trailing commas (common in JSONC)
          cleanJson = cleanJson.replace(/,(\s*[}\]])/g, '$1');

          const parsed = JSON.parse(cleanJson);
          resolve(parsed);
        } catch (err) {
          console.log(`    Warning: Failed to parse ${filename}: ${(err as Error).message}`);
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  console.log('=== Protocol Metadata Importer ===\n');

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
    max: 5,
  });

  try {
    // 1. Create tables if not exist
    console.log('1. Creating tables...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS protocols (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        logo_url TEXT,
        website TEXT,
        twitter TEXT,
        github TEXT,
        docs TEXT,
        discord TEXT,
        telegram TEXT,
        is_live BOOLEAN DEFAULT true,
        indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_metadata (
        address TEXT PRIMARY KEY,
        protocol_id INTEGER REFERENCES protocols(id),
        contract_name TEXT,
        nickname TEXT,
        notes TEXT,
        indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contract_metadata_protocol ON contract_metadata(protocol_id)
    `);
    console.log('   ✓ Tables ready\n');

    // 2. Fetch file list from GitHub
    console.log('2. Fetching protocol list from GitHub...');
    const files = await fetchFileList();
    console.log(`   Found ${files.length} protocol files\n`);

    // 3. Import each protocol
    console.log('3. Importing protocols...\n');

    let protocolsAdded = 0;
    let protocolsUpdated = 0;
    let contractsAdded = 0;
    let errors = 0;

    for (const file of files) {
      const data = await fetchProtocolFile(file);
      if (!data || !data.name) {
        errors++;
        continue;
      }

      process.stdout.write(`   ${data.name}... `);

      // Insert or update protocol
      const protocolResult = await pool.query(`
        INSERT INTO protocols (name, description, website, twitter, github, docs, discord, telegram, is_live)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          website = EXCLUDED.website,
          twitter = EXCLUDED.twitter,
          github = EXCLUDED.github,
          docs = EXCLUDED.docs,
          discord = EXCLUDED.discord,
          telegram = EXCLUDED.telegram,
          is_live = EXCLUDED.is_live
        RETURNING id, (xmax = 0) AS inserted
      `, [
        data.name,
        data.description || null,
        data.links?.project || null,
        data.links?.twitter || null,
        data.links?.github || null,
        data.links?.docs || null,
        data.links?.discord || null,
        data.links?.telegram || null,
        data.live !== false,
      ]);

      const protocolId = protocolResult.rows[0].id;
      const wasInserted = protocolResult.rows[0].inserted;

      if (wasInserted) {
        protocolsAdded++;
      } else {
        protocolsUpdated++;
      }

      // Insert contract addresses
      let contractCount = 0;
      if (data.addresses) {
        for (const [contractName, address] of Object.entries(data.addresses)) {
          if (typeof address !== 'string') continue;

          const normalizedAddress = address.toLowerCase();

          await pool.query(`
            INSERT INTO contract_metadata (address, protocol_id, contract_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (address) DO UPDATE SET
              protocol_id = EXCLUDED.protocol_id,
              contract_name = EXCLUDED.contract_name
          `, [normalizedAddress, protocolId, contractName]);

          contractCount++;
          contractsAdded++;
        }
      }

      console.log(`✓ (${contractCount} contracts)`);

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 50));
    }

    console.log('\n=== Results ===');
    console.log(`Protocols added: ${protocolsAdded}`);
    console.log(`Protocols updated: ${protocolsUpdated}`);
    console.log(`Contract addresses mapped: ${contractsAdded}`);
    console.log(`Errors: ${errors}`);

    // 4. Show summary
    const protocolCount = await pool.query('SELECT COUNT(*) as cnt FROM protocols');
    const contractCount = await pool.query('SELECT COUNT(*) as cnt FROM contract_metadata');

    console.log(`\nTotal in database:`);
    console.log(`  Protocols: ${protocolCount.rows[0].cnt}`);
    console.log(`  Contract mappings: ${contractCount.rows[0].cnt}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
