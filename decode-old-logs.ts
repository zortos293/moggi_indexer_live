import pg from 'pg';
import { EventDecoder } from './src/event-decoder';
import { CONFIG } from './src/config';

const { Pool } = pg;

interface LogRow {
  id: number;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
}

async function decodeOldLogs() {
  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    max: 10,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  });

  const decoder = new EventDecoder();
  const batchSize = 1000;
  let totalProcessed = 0;
  let totalDecoded = 0;
  let lastId = 0;

  console.log('Starting log decoding backfill...');
  console.log(`Connected to ${CONFIG.PG_HOST}:${CONFIG.PG_PORT}/${CONFIG.PG_DATABASE}`);

  try {
    // Get total count of logs to decode
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM logs WHERE event_name IS NULL AND topic0 IS NOT NULL'
    );
    const totalLogs = parseInt(countResult.rows[0].count);
    console.log(`Found ${totalLogs.toLocaleString()} logs to decode\n`);

    if (totalLogs === 0) {
      console.log('No logs need decoding. Exiting.');
      await pool.end();
      return;
    }

    while (true) {
      // Fetch batch of logs that haven't been decoded yet, tracking by ID
      const logsResult = await pool.query<LogRow>(
        `SELECT id, topic0, topic1, topic2, topic3, data
         FROM logs
         WHERE id > $1 AND event_name IS NULL AND topic0 IS NOT NULL
         ORDER BY id
         LIMIT $2`,
        [lastId, batchSize]
      );

      if (logsResult.rows.length === 0) {
        break;
      }

      const updates: Array<{
        id: number;
        eventName: string;
        eventSignature: string;
        eventStandard: string;
        decodedParams: string;
      }> = [];

      // Track unique unknown topics for debugging
      const unknownTopics = new Set<string>();

      for (const log of logsResult.rows) {
        if (!log.topic0) continue;

        // Build topics array from individual columns
        const topics: string[] = [log.topic0];
        if (log.topic1) topics.push(log.topic1);
        if (log.topic2) topics.push(log.topic2);
        if (log.topic3) topics.push(log.topic3);

        const decoded = decoder.decodeLog({
          address: '',
          topics: topics,
          data: log.data || '0x',
          blockNumber: '0x0',
          transactionHash: '',
          transactionIndex: '0x0',
          blockHash: '',
          logIndex: '0x0',
          removed: false,
        });

        if (decoded) {
          updates.push({
            id: log.id,
            eventName: decoded.eventName,
            eventSignature: decoded.eventSignature,
            eventStandard: decoded.standard,
            decodedParams: JSON.stringify(decoded.params),
          });
        } else if (unknownTopics.size < 10) {
          unknownTopics.add(log.topic0);
        }
      }

      // Show sample unknown topics on first batch
      if (totalProcessed === 0 && unknownTopics.size > 0) {
        console.log('\nSample unknown topic0 hashes:');
        unknownTopics.forEach(t => console.log(`  ${t}`));
        console.log('');
      }

      // Update lastId to the maximum ID in this batch
      lastId = logsResult.rows[logsResult.rows.length - 1].id;

      // Batch update decoded logs
      if (updates.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (const update of updates) {
            await client.query(
              `UPDATE logs
               SET event_name = $1, event_signature = $2, event_standard = $3, decoded_params = $4
               WHERE id = $5`,
              [update.eventName, update.eventSignature, update.eventStandard, update.decodedParams, update.id]
            );
          }

          await client.query('COMMIT');
          totalDecoded += updates.length;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      totalProcessed += logsResult.rows.length;
      const progress = ((totalProcessed / totalLogs) * 100).toFixed(2);
      process.stdout.write(
        `\rProcessed: ${totalProcessed.toLocaleString()}/${totalLogs.toLocaleString()} (${progress}%) | Decoded: ${totalDecoded.toLocaleString()}`.padEnd(100)
      );

      // If we got fewer than batch size, we're done
      if (logsResult.rows.length < batchSize) {
        break;
      }
    }

    console.log('\n\nBackfill complete!');
    console.log(`Total logs processed: ${totalProcessed.toLocaleString()}`);
    console.log(`Total logs decoded: ${totalDecoded.toLocaleString()}`);
    console.log(`Decode rate: ${((totalDecoded / totalProcessed) * 100).toFixed(2)}%`);
  } catch (error) {
    console.error('\nError during backfill:', error);
  } finally {
    await pool.end();
  }
}

// Also add option to re-decode ALL logs (including already decoded ones)
async function reDecodeAllLogs() {
  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    max: 10,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
  });

  const decoder = new EventDecoder();
  const batchSize = 1000;
  let totalProcessed = 0;
  let totalDecoded = 0;
  let lastId = 0;

  console.log('Re-decoding ALL logs...');
  console.log(`Connected to ${CONFIG.PG_HOST}:${CONFIG.PG_PORT}/${CONFIG.PG_DATABASE}`);

  try {
    const countResult = await pool.query('SELECT COUNT(*) as count FROM logs WHERE topic0 IS NOT NULL');
    const totalLogs = parseInt(countResult.rows[0].count);
    console.log(`Found ${totalLogs.toLocaleString()} logs to process\n`);

    while (true) {
      const logsResult = await pool.query<LogRow>(
        `SELECT id, topic0, topic1, topic2, topic3, data
         FROM logs
         WHERE id > $1 AND topic0 IS NOT NULL
         ORDER BY id
         LIMIT $2`,
        [lastId, batchSize]
      );

      if (logsResult.rows.length === 0) {
        break;
      }

      const updates: Array<{
        id: number;
        eventName: string | null;
        eventSignature: string | null;
        eventStandard: string | null;
        decodedParams: string | null;
      }> = [];

      for (const log of logsResult.rows) {
        if (!log.topic0) continue;

        // Build topics array from individual columns
        const topics: string[] = [log.topic0];
        if (log.topic1) topics.push(log.topic1);
        if (log.topic2) topics.push(log.topic2);
        if (log.topic3) topics.push(log.topic3);

        const decoded = decoder.decodeLog({
          address: '',
          topics: topics,
          data: log.data || '0x',
          blockNumber: '0x0',
          transactionHash: '',
          transactionIndex: '0x0',
          blockHash: '',
          logIndex: '0x0',
          removed: false,
        });

        if (decoded) {
          updates.push({
            id: log.id,
            eventName: decoded.eventName,
            eventSignature: decoded.eventSignature,
            eventStandard: decoded.standard,
            decodedParams: JSON.stringify(decoded.params),
          });
        } else {
          // Clear any existing decoded data for unknown events
          updates.push({
            id: log.id,
            eventName: null,
            eventSignature: null,
            eventStandard: null,
            decodedParams: null,
          });
        }

        lastId = log.id;
      }

      // Batch update
      if (updates.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (const update of updates) {
            if (update.eventName) {
              await client.query(
                `UPDATE logs
                 SET event_name = $1, event_signature = $2, event_standard = $3, decoded_params = $4
                 WHERE id = $5`,
                [update.eventName, update.eventSignature, update.eventStandard, update.decodedParams, update.id]
              );
              totalDecoded++;
            }
          }

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      totalProcessed += logsResult.rows.length;
      const progress = ((totalProcessed / totalLogs) * 100).toFixed(2);
      process.stdout.write(
        `\rProcessed: ${totalProcessed.toLocaleString()}/${totalLogs.toLocaleString()} (${progress}%) | Decoded: ${totalDecoded.toLocaleString()}`.padEnd(100)
      );

      if (logsResult.rows.length < batchSize) {
        break;
      }
    }

    console.log('\n\nRe-decode complete!');
    console.log(`Total logs processed: ${totalProcessed.toLocaleString()}`);
    console.log(`Total logs decoded: ${totalDecoded.toLocaleString()}`);
    console.log(`Decode rate: ${((totalDecoded / totalProcessed) * 100).toFixed(2)}%`);
  } catch (error) {
    console.error('\nError during re-decode:', error);
  } finally {
    await pool.end();
  }
}

// Main
const args = process.argv.slice(2);
if (args.includes('--all')) {
  reDecodeAllLogs();
} else {
  decodeOldLogs();
}
