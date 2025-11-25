import { Pool } from 'pg';
import { CONFIG } from './src/config';

const pool = new Pool({
  host: CONFIG.PG_HOST,
  port: CONFIG.PG_PORT,
  database: CONFIG.PG_DATABASE,
  user: CONFIG.PG_USER,
  password: CONFIG.PG_PASSWORD,
  ssl: { rejectUnauthorized: CONFIG.PG_SSL },
});

async function dropAllTables() {
  console.log('Dropping all tables in PostgreSQL...');

  const client = await pool.connect();
  try {
    await client.query('DROP TABLE IF EXISTS erc721_transfers CASCADE');
    console.log('  Dropped erc721_transfers');

    await client.query('DROP TABLE IF EXISTS erc20_transfers CASCADE');
    console.log('  Dropped erc20_transfers');

    await client.query('DROP TABLE IF EXISTS address_transactions CASCADE');
    console.log('  Dropped address_transactions');

    await client.query('DROP TABLE IF EXISTS addresses CASCADE');
    console.log('  Dropped addresses');

    await client.query('DROP TABLE IF EXISTS erc1155_tokens CASCADE');
    console.log('  Dropped erc1155_tokens');

    await client.query('DROP TABLE IF EXISTS erc721_tokens CASCADE');
    console.log('  Dropped erc721_tokens');

    await client.query('DROP TABLE IF EXISTS erc20_tokens CASCADE');
    console.log('  Dropped erc20_tokens');

    await client.query('DROP TABLE IF EXISTS contracts CASCADE');
    console.log('  Dropped contracts');

    await client.query('DROP TABLE IF EXISTS logs CASCADE');
    console.log('  Dropped logs');

    await client.query('DROP TABLE IF EXISTS transactions CASCADE');
    console.log('  Dropped transactions');

    await client.query('DROP TABLE IF EXISTS blocks CASCADE');
    console.log('  Dropped blocks');

    await client.query('DROP TABLE IF EXISTS indexer_state CASCADE');
    console.log('  Dropped indexer_state');

    console.log('\nAll tables dropped successfully!');
  } finally {
    client.release();
    await pool.end();
  }
}

dropAllTables().catch(console.error);
