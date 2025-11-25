import { Pool } from 'pg';
import * as fs from 'fs';

// Load environment variables
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

// Try connecting to 'postgres' database (default admin database)
const pgConfig = {
  host: process.env.PG_HOST || 'eu-west-3.pg.psdb.cloud',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: 'postgres', // Try default postgres database
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: true },
};

async function testConnection() {
  console.log('Attempting to connect to postgres database...');
  console.log(`Host: ${pgConfig.host}`);
  console.log(`User: ${pgConfig.user}`);

  const pool = new Pool(pgConfig);

  try {
    const client = await pool.connect();
    console.log('Connected successfully!');

    // List all databases
    const result = await client.query(`
      SELECT datname FROM pg_database
      WHERE datistemplate = false
      ORDER BY datname
    `);

    console.log('\nAvailable databases:');
    result.rows.forEach(row => {
      console.log(`  - ${row.datname}`);
    });

    client.release();
  } catch (error: any) {
    console.error('Connection failed:', error.message);

    // Try alternative database names
    const alternatives = ['monad_indexer', 'defaultdb', 'postgres'];
    for (const dbName of alternatives) {
      console.log(`\nTrying database: ${dbName}...`);
      const altPool = new Pool({ ...pgConfig, database: dbName });
      try {
        const client = await altPool.connect();
        console.log(`SUCCESS! Connected to ${dbName}`);

        const result = await client.query('SELECT current_database()');
        console.log(`Current database: ${result.rows[0].current_database}`);

        client.release();
        await altPool.end();
        break;
      } catch (e: any) {
        console.log(`  Failed: ${e.message.split('\n')[0]}`);
        await altPool.end();
      }
    }
  } finally {
    await pool.end();
  }
}

testConnection().catch(console.error);
