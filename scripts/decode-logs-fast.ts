/**
 * Fast batch decoder for logs using function_signatures table
 * Optimized for millions of logs - processes each signature separately for index efficiency
 *
 * Usage: npx tsx scripts/decode-logs-fast.ts
 */

import { Pool } from 'pg';
import { CONFIG } from '../src/config';

async function main() {
  console.log('=== Fast Log Decoder ===\n');

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
    // Step 1: Ensure index exists on topic0 for fast lookups
    console.log('1. Ensuring index on logs.topic0...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_topic0 ON logs(topic0)
    `);
    console.log('   ✓ Index ready\n');

    // Step 2: Count total logs to decode
    console.log('2. Counting logs to decode...');
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM logs
      WHERE topic0 IS NOT NULL
        AND event_name IS NULL
    `);
    const totalToDecode = parseInt(countResult.rows[0].total);
    console.log(`   Found ${totalToDecode.toLocaleString()} logs to decode\n`);

    if (totalToDecode === 0) {
      console.log('No logs need decoding. Done!');
      return;
    }

    // Step 3: Load all event signatures into memory
    console.log('3. Loading event signatures...');
    const signatures = await pool.query(`
      SELECT selector, name, signature
      FROM function_signatures
      WHERE type = 'event'
    `);
    console.log(`   Loaded ${signatures.rows.length} signatures\n`);

    if (signatures.rows.length === 0) {
      console.log('No event signatures found. Run scan:abi first.');
      return;
    }

    // Step 4: Process each signature - this uses index efficiently
    console.log('4. Decoding logs by signature...\n');

    let totalUpdated = 0;
    const startTime = Date.now();

    for (let i = 0; i < signatures.rows.length; i++) {
      const sig = signatures.rows[i];
      const batchStart = Date.now();

      // Update all logs with this topic0 in one query - uses index!
      const result = await pool.query(`
        UPDATE logs
        SET event_name = $1, event_signature = $2
        WHERE topic0 = $3 AND event_name IS NULL
      `, [sig.name, sig.signature, sig.selector]);

      const updated = result.rowCount || 0;

      if (updated > 0) {
        totalUpdated += updated;

        const batchTime = ((Date.now() - batchStart) / 1000).toFixed(2);
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const logsPerSec = Math.round(updated / parseFloat(batchTime));

        console.log(
          `   [${i + 1}/${signatures.rows.length}] ${sig.name}: ${updated.toLocaleString()} logs in ${batchTime}s ` +
          `(${logsPerSec.toLocaleString()}/s) | Total: ${totalUpdated.toLocaleString()} | ${totalTime}s`
        );
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgSpeed = totalUpdated > 0 ? Math.round(totalUpdated / parseFloat(totalTime)) : 0;

    console.log('\n=== Results ===');
    console.log(`Total logs decoded: ${totalUpdated.toLocaleString()}`);
    console.log(`Time elapsed: ${totalTime}s`);
    console.log(`Average speed: ${avgSpeed.toLocaleString()} logs/second`);

    // Step 5: Show remaining undecoded (no matching signature)
    const remaining = await pool.query(`
      SELECT COUNT(*) as total
      FROM logs
      WHERE topic0 IS NOT NULL
        AND event_name IS NULL
    `);
    const stillNull = parseInt(remaining.rows[0].total);

    if (stillNull > 0) {
      console.log(`\nNote: ${stillNull.toLocaleString()} logs have no matching signature in database`);

      // Show top unknown topic0 hashes
      const unknown = await pool.query(`
        SELECT topic0, COUNT(*) as cnt
        FROM logs
        WHERE topic0 IS NOT NULL AND event_name IS NULL
        GROUP BY topic0
        ORDER BY cnt DESC
        LIMIT 10
      `);

      if (unknown.rows.length > 0) {
        console.log('\nTop 10 unknown event signatures:');
        for (const row of unknown.rows) {
          console.log(`  ${row.topic0}: ${parseInt(row.cnt).toLocaleString()} logs`);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
