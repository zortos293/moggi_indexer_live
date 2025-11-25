import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './src/config';

async function main() {
  const args = process.argv.slice(2);
  const shouldDrop = args.includes('--drop');
  const shouldReset = args.includes('--reset');

  console.log('🗄️  Database Reset Tool\n');
  console.log(`Host: ${CONFIG.PG_HOST}`);
  console.log(`Database: ${CONFIG.PG_DATABASE}`);
  console.log(`User: ${CONFIG.PG_USER}\n`);

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  });

  try {
    if (shouldDrop) {
      console.log('⚠️  Dropping all tables...');
      await pool.query(`
        DROP TABLE IF EXISTS erc1155_transfers CASCADE;
        DROP TABLE IF EXISTS erc721_transfers CASCADE;
        DROP TABLE IF EXISTS erc20_transfers CASCADE;
        DROP TABLE IF EXISTS address_transactions CASCADE;
        DROP TABLE IF EXISTS logs CASCADE;
        DROP TABLE IF EXISTS erc1155_tokens CASCADE;
        DROP TABLE IF EXISTS erc721_tokens CASCADE;
        DROP TABLE IF EXISTS erc20_tokens CASCADE;
        DROP TABLE IF EXISTS contracts CASCADE;
        DROP TABLE IF EXISTS addresses CASCADE;
        DROP TABLE IF EXISTS transactions CASCADE;
        DROP TABLE IF EXISTS blocks CASCADE;
        DROP TABLE IF EXISTS indexer_state CASCADE;
      `);
      console.log('✅ All tables dropped\n');
    }

    if (shouldReset && !shouldDrop) {
      console.log('🔄 Resetting indexer state (keeping tables)...');
      await pool.query(`
        UPDATE indexer_state
        SET forward_block = 0,
            backward_block = NULL,
            is_synced = false,
            latest_block = 0
        WHERE id = 1
      `);
      console.log('✅ Indexer state reset to block 0\n');
    }

    // Apply schema
    console.log('📦 Applying PostgreSQL schema...');
    const schemaPath = path.join(__dirname, 'schema-postgres.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Remove SQL comments first
    const cleanedSchema = schema
      .split('\n')
      .map(line => {
        // Remove line comments
        const commentIndex = line.indexOf('--');
        if (commentIndex !== -1) {
          return line.substring(0, commentIndex);
        }
        return line;
      })
      .join('\n');

    // Split by semicolons and execute each statement
    const statements = cleanedSchema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let successCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      try {
        await pool.query(statement);
        successCount++;
        // Show what we're creating
        const match = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
        if (match) {
          console.log(`   ✓ Created table: ${match[1]}`);
        }
      } catch (error: any) {
        // Ignore "already exists" errors
        if (!error.message.includes('already exists')) {
          errorCount++;
          console.error(`\n   ✗ Error executing: ${statement.substring(0, 100)}...`);
          console.error(`     ${error.message}\n`);
        }
      }
    }

    console.log(`\n✅ Schema applied: ${successCount} statements executed, ${errorCount} errors\n`);

    // Check current state
    const stateResult = await pool.query('SELECT * FROM indexer_state WHERE id = 1');
    if (stateResult.rows.length > 0) {
      const state = stateResult.rows[0];
      console.log('📊 Current indexer state:');
      console.log(`   Forward block: ${state.forward_block}`);
      console.log(`   Backward block: ${state.backward_block || 'Not set'}`);
      console.log(`   Latest block: ${state.latest_block}`);
      console.log(`   Is synced: ${state.is_synced}`);
    } else {
      // Insert initial state
      await pool.query(`
        INSERT INTO indexer_state (id, forward_block, backward_block, latest_block, is_synced)
        VALUES (1, 0, NULL, 0, false)
      `);
      console.log('✅ Created initial indexer state (starting from block 0)');
    }

    console.log('\n🚀 Database is ready! Run: npm run fast');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
