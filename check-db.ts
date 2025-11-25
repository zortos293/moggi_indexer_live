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

async function check() {
  const client = await pool.connect();
  try {
    console.log('Checking actual data in PostgreSQL...\n');

    const blocksCount = await client.query('SELECT COUNT(*)::text as count FROM blocks');
    console.log('Blocks count (raw):', blocksCount.rows[0]);

    const txCount = await client.query('SELECT COUNT(*)::text as count FROM transactions');
    console.log('Transactions count (raw):', txCount.rows[0]);

    const logsCount = await client.query('SELECT COUNT(*)::text as count FROM logs');
    console.log('Logs count (raw):', logsCount.rows[0]);

    // Sample actual data
    const sampleBlock = await client.query('SELECT number FROM blocks ORDER BY number LIMIT 3');
    console.log('\nSample blocks:', sampleBlock.rows);

    const sampleTx = await client.query('SELECT hash FROM transactions LIMIT 3');
    console.log('Sample transactions:', sampleTx.rows);

    // Check table sizes
    const sizes = await client.query(`
      SELECT
        relname as table_name,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size,
        reltuples::bigint as estimated_rows
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
    `);
    console.log('\nTable sizes:');
    sizes.rows.forEach(row => {
      console.log(`  ${row.table_name}: ${row.total_size} (~${row.estimated_rows} rows)`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

check().catch(console.error);
