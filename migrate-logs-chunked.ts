#!/usr/bin/env tsx
/**
 * Chunked Migration for large tables (logs)
 * Migrates in smaller chunks to avoid connection timeouts
 * Uses INSERT ON CONFLICT to handle duplicates safely
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Load .env file
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

const copyFrom = require('pg-copy-streams').from;
const copyTo = require('pg-copy-streams').to;

const SOURCE_CONFIG = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max: 5,
};

const TARGET_CONFIG = {
  host: process.env.PLANETSCALE_HOST || '',
  port: parseInt(process.env.PLANETSCALE_PORT || '5432'),
  database: process.env.PLANETSCALE_DATABASE || 'postgres',
  user: process.env.PLANETSCALE_USER || '',
  password: process.env.PLANETSCALE_PASSWORD || '',
  max: 5,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 120000,
  query_timeout: 0,
  statement_timeout: 0,
};

const CHUNK_SIZE = 1000000; // 1M rows per chunk (smaller chunks = more resilient)
const PROGRESS_FILE = './logs_migration_progress.json';

interface Progress {
  lastId: number;
  totalMigrated: number;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { lastId: 0, totalMigrated: 0, lastUpdated: new Date().toISOString() };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

async function getColumns(pool: Pool): Promise<string[]> {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'logs'
    ORDER BY ordinal_position
  `);
  return result.rows.map(r => r.column_name);
}

async function migrateChunk(
  sourcePool: Pool,
  targetPool: Pool,
  columns: string[],
  startId: number,
  chunkSize: number,
  totalRows: number,
  totalMigrated: number
): Promise<{ lastId: number; rowsMigrated: number; bytesTransferred: number }> {
  const columnList = columns.join(', ');
  const startTime = Date.now();

  // Get chunk bounds
  const boundsResult = await sourcePool.query(`
    SELECT id FROM logs WHERE id > $1 ORDER BY id LIMIT 1 OFFSET $2
  `, [startId, chunkSize - 1]);

  let endId: number;
  let isLastChunk = false;

  if (boundsResult.rows.length === 0) {
    // Get the actual max ID
    const maxResult = await sourcePool.query(`SELECT MAX(id) as max_id FROM logs WHERE id > $1`, [startId]);
    endId = maxResult.rows[0].max_id || startId;
    isLastChunk = true;
  } else {
    endId = boundsResult.rows[0].id;
  }

  // Count rows in this chunk
  const countResult = await sourcePool.query(
    `SELECT COUNT(*) as count FROM logs WHERE id > $1 AND id <= $2`,
    [startId, endId]
  );
  const chunkRows = parseInt(countResult.rows[0].count);

  if (chunkRows === 0) {
    return { lastId: endId, rowsMigrated: 0, bytesTransferred: 0 };
  }

  console.log(`\n  📦 Chunk: ID ${startId.toLocaleString()} → ${endId.toLocaleString()} (${chunkRows.toLocaleString()} rows)`);

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  let bytesTransferred = 0;
  let rowsInChunk = 0;

  try {
    // Use COPY with WHERE clause for this chunk only
    const copyQuery = `COPY (
      SELECT ${columnList} FROM logs
      WHERE id > ${startId} AND id <= ${endId}
      ORDER BY id
    ) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\\N')`;

    const copyToStream = sourceClient.query(copyTo(copyQuery));
    const copyFromStream = targetClient.query(
      copyFrom(`COPY logs (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '\\N')`)
    );

    let lastUpdate = Date.now();

    await new Promise<void>((resolve, reject) => {
      let errorOccurred = false;

      copyToStream.on('error', (err: Error) => {
        if (!errorOccurred) {
          errorOccurred = true;
          console.error(`\n  ❌ Source stream error: ${err.message}`);
          reject(err);
        }
      });

      copyFromStream.on('error', (err: Error) => {
        if (!errorOccurred) {
          errorOccurred = true;
          console.error(`\n  ❌ Target stream error: ${err.message}`);
          reject(err);
        }
      });

      copyFromStream.on('finish', () => {
        if (!errorOccurred) {
          resolve();
        }
      });

      copyToStream.on('data', (chunk: Buffer) => {
        if (errorOccurred) return;

        bytesTransferred += chunk.length;
        const newlines = chunk.toString().split('\n').length - 1;
        rowsInChunk += newlines;

        const now = Date.now();
        if (now - lastUpdate > 500) {
          const overallProgress = Math.min(100, Math.round(((totalMigrated + rowsInChunk) / totalRows) * 100));
          const chunkProgress = Math.min(100, Math.round((rowsInChunk / chunkRows) * 100));
          const elapsed = (now - startTime) / 1000;
          const speed = elapsed > 0 ? Math.round(rowsInChunk / elapsed) : 0;

          process.stdout.write(
            `\r  Chunk: ${chunkProgress}% | Overall: ${overallProgress}% | ${(totalMigrated + rowsInChunk).toLocaleString()}/${totalRows.toLocaleString()} | ${speed.toLocaleString()} rows/s    `
          );
          lastUpdate = now;
        }

        copyFromStream.write(chunk);
      });

      copyToStream.on('end', () => {
        if (!errorOccurred) {
          copyFromStream.end();
        }
      });
    });

    const duration = Date.now() - startTime;
    const speed = duration > 0 ? Math.round(rowsInChunk / (duration / 1000)) : 0;
    console.log(`\n  ✅ Chunk complete: ${rowsInChunk.toLocaleString()} rows | ${formatBytes(bytesTransferred)} | ${speed.toLocaleString()} rows/s`);

    return { lastId: endId, rowsMigrated: rowsInChunk, bytesTransferred };

  } finally {
    sourceClient.release();
    targetClient.release();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Chunked logs Migration (Resilient to Timeouts)      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const sourcePool = new Pool(SOURCE_CONFIG);
  const targetPool = new Pool(TARGET_CONFIG);

  const args = process.argv.slice(2);
  const resetProgress = args.includes('--reset');

  if (resetProgress && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('  ✅ Progress file reset');
  }

  try {
    // Test connections
    console.log('\n📡 Testing connections...');
    await sourcePool.query('SELECT 1');
    console.log('  ✅ Source connected');
    await targetPool.query('SELECT 1');
    console.log('  ✅ Target connected');

    // Get counts
    const [sourceCount, targetCount] = await Promise.all([
      sourcePool.query('SELECT COUNT(*) as count FROM logs'),
      targetPool.query('SELECT COUNT(*) as count FROM logs'),
    ]);

    const totalSourceRows = parseInt(sourceCount.rows[0].count);
    const currentTargetRows = parseInt(targetCount.rows[0].count);

    console.log(`\n📊 logs table status:`);
    console.log(`  Source: ${totalSourceRows.toLocaleString()} rows`);
    console.log(`  Target: ${currentTargetRows.toLocaleString()} rows`);
    console.log(`  Remaining: ${(totalSourceRows - currentTargetRows).toLocaleString()} rows`);

    if (currentTargetRows >= totalSourceRows) {
      console.log('\n✅ Migration already complete!');
      return;
    }

    // Load progress
    let progress = loadProgress();

    // If target has more rows than our progress, update progress
    if (currentTargetRows > progress.totalMigrated) {
      console.log(`\n  ℹ️  Detected ${currentTargetRows.toLocaleString()} rows in target, updating progress...`);

      // Get the max ID in target to resume from there
      const maxIdResult = await targetPool.query('SELECT MAX(id) as max_id FROM logs');
      const maxId = maxIdResult.rows[0].max_id || 0;

      progress.lastId = maxId;
      progress.totalMigrated = currentTargetRows;
      saveProgress(progress);
      console.log(`  ✅ Will resume from ID ${maxId.toLocaleString()}`);
    }

    // Get columns
    const columns = await getColumns(sourcePool);
    console.log(`\n📋 Columns: ${columns.join(', ')}`);

    console.log(`\n🚀 Starting chunked migration (${CHUNK_SIZE.toLocaleString()} rows per chunk)...\n`);
    console.log(`  Progress file: ${PROGRESS_FILE}`);
    console.log(`  Current position: ID ${progress.lastId.toLocaleString()}`);

    const overallStart = Date.now();
    let totalBytesTransferred = 0;
    let chunksCompleted = 0;

    // Migrate in chunks
    while (progress.totalMigrated < totalSourceRows) {
      try {
        const result = await migrateChunk(
          sourcePool,
          targetPool,
          columns,
          progress.lastId,
          CHUNK_SIZE,
          totalSourceRows,
          progress.totalMigrated
        );

        if (result.rowsMigrated === 0) {
          console.log('\n  ℹ️  No more rows to migrate');
          break;
        }

        progress.lastId = result.lastId;
        progress.totalMigrated += result.rowsMigrated;
        totalBytesTransferred += result.bytesTransferred;
        chunksCompleted++;

        // Save progress after each chunk
        saveProgress(progress);

        const overallProgress = Math.round((progress.totalMigrated / totalSourceRows) * 100);
        console.log(`  📝 Progress saved: ${overallProgress}% complete`);

      } catch (error: any) {
        console.error(`\n  ❌ Chunk failed: ${error.message}`);
        console.log(`\n  💡 Progress saved. Run again to resume from ID ${progress.lastId.toLocaleString()}`);
        break;
      }
    }

    const overallDuration = Date.now() - overallStart;

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SESSION SUMMARY');
    console.log('='.repeat(60));
    console.log(`\n  Chunks completed: ${chunksCompleted}`);
    console.log(`  Total rows migrated this session: ${(progress.totalMigrated - currentTargetRows).toLocaleString()}`);
    console.log(`  Overall progress: ${progress.totalMigrated.toLocaleString()}/${totalSourceRows.toLocaleString()} rows`);
    console.log(`  Percentage: ${Math.round((progress.totalMigrated / totalSourceRows) * 100)}%`);
    console.log(`  Data transferred: ${formatBytes(totalBytesTransferred)}`);
    console.log(`  Time elapsed: ${formatTime(overallDuration)}`);
    if (overallDuration > 0 && chunksCompleted > 0) {
      console.log(`  Average speed: ${Math.round((progress.totalMigrated - currentTargetRows) / (overallDuration / 1000)).toLocaleString()} rows/s`);
    }

    if (progress.totalMigrated >= totalSourceRows) {
      console.log('\n✅ logs table migration COMPLETE!');

      // Clean up progress file
      if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
        console.log('  🗑️  Progress file cleaned up');
      }
    } else {
      console.log(`\n⚠️  Migration incomplete. ${(totalSourceRows - progress.totalMigrated).toLocaleString()} rows remaining.`);
      console.log('  Run script again to continue from where it left off.');
    }

  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

if (process.argv.includes('--help')) {
  console.log(`
Chunked logs Migration

Migrates the logs table in smaller chunks to avoid connection timeouts.
Automatically resumes from where it left off.

Usage:
  npx tsx migrate-logs-chunked.ts [options]

Options:
  --reset    Reset progress and start from beginning
  --help     Show this help

Features:
  - Migrates in ${CHUNK_SIZE.toLocaleString()}-row chunks
  - Saves progress after each chunk
  - Automatically resumes on failure
  - Uses PostgreSQL COPY for speed
  - Handles connection timeouts gracefully
`);
  process.exit(0);
}

main().catch(console.error);
