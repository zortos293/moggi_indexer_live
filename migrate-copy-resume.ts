#!/usr/bin/env tsx
/**
 * PostgreSQL to PlanetScale Migration - COPY Stream Version WITH RESUME
 * Uses PostgreSQL COPY protocol for maximum speed (100k+ rows/sec)
 * Supports resuming from where it left off after failures
 */

import { Pool, PoolClient } from 'pg';
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

// Source (local PostgreSQL)
const SOURCE_CONFIG = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max: 5,
};

// Target (PlanetScale)
const TARGET_CONFIG = {
  host: process.env.PLANETSCALE_HOST || '',
  port: parseInt(process.env.PLANETSCALE_PORT || '5432'),
  database: process.env.PLANETSCALE_DATABASE || 'postgres',
  user: process.env.PLANETSCALE_USER || '',
  password: process.env.PLANETSCALE_PASSWORD || '',
  max: 5,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 60000,
  statement_timeout: 0, // No statement timeout
  idle_in_transaction_session_timeout: 0, // No idle timeout
};

const TABLE_ORDER = [
  'blocks',
  'transactions',
  'logs',
  'contracts',
  'erc20_tokens',
  'erc721_tokens',
  'erc1155_tokens',
  'addresses',
  'address_transactions',
  'erc20_transfers',
  'erc721_transfers',
  'erc1155_transfers',
  'indexer_state',
];

// Primary keys for offset-based resume
const TABLE_PRIMARY_KEYS: Record<string, string> = {
  blocks: 'number',
  transactions: 'hash',
  logs: 'id',
  contracts: 'address',
  erc20_tokens: 'address',
  erc721_tokens: 'address',
  erc1155_tokens: 'address',
  addresses: 'address',
  address_transactions: 'id',
  erc20_transfers: 'id',
  erc721_transfers: 'id',
  erc1155_transfers: 'id',
  indexer_state: 'key',
};

interface MigrationProgress {
  completedTables: string[];
  inProgressTable?: string;
  lastOffset?: number;
  lastUpdated: string;
}

interface MigrationStats {
  table: string;
  rows: number;
  duration: number;
  bytesTransferred: number;
  skipped?: boolean;
}

const PROGRESS_FILE = './migration_progress.json';
const BATCH_SIZE = 1000000; // 1M rows per batch for large tables

function loadProgress(): MigrationProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completedTables: [], lastUpdated: new Date().toISOString() };
}

function saveProgress(progress: MigrationProgress): void {
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

class ResumableCopyMigrator {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats[] = [];
  private progress: MigrationProgress;

  constructor() {
    this.sourcePool = new Pool(SOURCE_CONFIG);
    this.targetPool = new Pool(TARGET_CONFIG);
    this.progress = loadProgress();
  }

  async testConnections(): Promise<boolean> {
    console.log('\n📡 Testing database connections...\n');

    try {
      const sourceClient = await this.sourcePool.connect();
      const sourceResult = await sourceClient.query('SELECT version()');
      console.log('✅ Source PostgreSQL:', sourceResult.rows[0].version.split(',')[0]);
      sourceClient.release();
    } catch (error: any) {
      console.error('❌ Source connection failed:', error.message);
      return false;
    }

    try {
      const targetClient = await this.targetPool.connect();
      const targetResult = await targetClient.query('SELECT version()');
      console.log('✅ Target PlanetScale:', targetResult.rows[0].version.split(',')[0]);
      targetClient.release();
    } catch (error: any) {
      console.error('❌ Target connection failed:', error.message);
      return false;
    }

    return true;
  }

  async getColumns(table: string): Promise<string[]> {
    const result = await this.sourcePool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    return result.rows.map(r => r.column_name);
  }

  async getTableCounts(table: string): Promise<{ source: number; target: number }> {
    const [sourceResult, targetResult] = await Promise.all([
      this.sourcePool.query(`SELECT COUNT(*) as count FROM ${table}`),
      this.targetPool.query(`SELECT COUNT(*) as count FROM ${table}`).catch(() => ({ rows: [{ count: 0 }] }))
    ]);

    return {
      source: parseInt(sourceResult.rows[0].count),
      target: parseInt(targetResult.rows[0].count)
    };
  }

  async migrateTableWithCopy(table: string, forceRestart: boolean = false): Promise<MigrationStats> {
    const startTime = Date.now();
    console.log(`\n📦 Migrating: ${table}`);

    // Check if already completed
    if (this.progress.completedTables.includes(table) && !forceRestart) {
      console.log(`  ⏭️  Already completed (skipping)`);
      return { table, rows: 0, duration: 0, bytesTransferred: 0, skipped: true };
    }

    // Get counts
    const counts = await this.getTableCounts(table);
    console.log(`  Source rows: ${counts.source.toLocaleString()}`);
    console.log(`  Target rows: ${counts.target.toLocaleString()}`);

    if (counts.source === 0) {
      console.log(`  ✅ Empty table`);
      this.progress.completedTables.push(table);
      saveProgress(this.progress);
      return { table, rows: 0, duration: 0, bytesTransferred: 0 };
    }

    // Check if already fully migrated
    if (counts.target >= counts.source && !forceRestart) {
      console.log(`  ✅ Already fully migrated (${counts.target.toLocaleString()} rows)`);
      if (!this.progress.completedTables.includes(table)) {
        this.progress.completedTables.push(table);
        saveProgress(this.progress);
      }
      return { table, rows: counts.target, duration: 0, bytesTransferred: 0, skipped: true };
    }

    // Determine if we should resume or restart
    const shouldResume = counts.target > 0 && counts.target < counts.source && !forceRestart;

    if (shouldResume) {
      console.log(`  🔄 Resuming from row ${counts.target.toLocaleString()} (${Math.round((counts.target / counts.source) * 100)}% complete)`);
      return await this.resumeTableMigration(table, counts.source, counts.target);
    }

    // Start fresh migration
    if (counts.target > 0) {
      console.log(`  🗑️  Truncating incomplete data...`);
      const targetClient = await this.targetPool.connect();
      await targetClient.query(`TRUNCATE TABLE ${table} CASCADE`);
      targetClient.release();
    }

    // Mark as in progress
    this.progress.inProgressTable = table;
    this.progress.lastOffset = 0;
    saveProgress(this.progress);

    // Perform full COPY migration
    return await this.performCopyMigration(table, counts.source);
  }

  private async performCopyMigration(table: string, totalRows: number): Promise<MigrationStats> {
    const startTime = Date.now();
    const columns = await this.getColumns(table);
    const columnList = columns.join(', ');

    const targetClient = await this.targetPool.connect();
    const sourceClient = await this.sourcePool.connect();

    let bytesTransferred = 0;
    let rowsMigrated = 0;
    let lastUpdate = Date.now();

    try {
      const copyToStream = sourceClient.query(
        copyTo(`COPY ${table} (${columnList}) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\\N')`)
      );

      const copyFromStream = targetClient.query(
        copyFrom(`COPY ${table} (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '\\N')`)
      );

      await new Promise<void>((resolve, reject) => {
        copyToStream.on('error', (err: Error) => {
          console.error(`\n  ❌ Source stream error: ${err.message}`);
          reject(err);
        });
        copyFromStream.on('error', (err: Error) => {
          console.error(`\n  ❌ Target stream error: ${err.message}`);
          reject(err);
        });
        copyFromStream.on('finish', resolve);

        copyToStream.on('data', (chunk: Buffer) => {
          bytesTransferred += chunk.length;
          const newlines = chunk.toString().split('\n').length - 1;
          rowsMigrated += newlines;

          const now = Date.now();
          if (now - lastUpdate > 500) {
            const progress = Math.min(100, Math.round((rowsMigrated / totalRows) * 100));
            const elapsed = (now - startTime) / 1000;
            const speed = Math.round(rowsMigrated / elapsed);
            const eta = rowsMigrated > 0 ? Math.round((totalRows - rowsMigrated) / speed) : 0;
            process.stdout.write(`\r  Progress: ${progress}% | ${rowsMigrated.toLocaleString()}/${totalRows.toLocaleString()} | ${speed.toLocaleString()} rows/s | ETA: ${eta}s    `);
            lastUpdate = now;

            // Save progress periodically
            this.progress.lastOffset = rowsMigrated;
            if (now - lastUpdate > 10000) {
              saveProgress(this.progress);
            }
          }

          copyFromStream.write(chunk);
        });

        copyToStream.on('end', () => {
          copyFromStream.end();
        });
      });

      const duration = Date.now() - startTime;
      const avgSpeed = Math.round(totalRows / (duration / 1000));
      console.log(`\n  ✅ Migrated ${totalRows.toLocaleString()} rows | ${formatBytes(bytesTransferred)} | ${avgSpeed.toLocaleString()} rows/s`);

      // Mark as completed
      if (!this.progress.completedTables.includes(table)) {
        this.progress.completedTables.push(table);
      }
      this.progress.inProgressTable = undefined;
      this.progress.lastOffset = undefined;
      saveProgress(this.progress);

      return { table, rows: totalRows, duration, bytesTransferred };
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  }

  private async resumeTableMigration(table: string, totalRows: number, alreadyMigrated: number): Promise<MigrationStats> {
    const startTime = Date.now();
    const columns = await this.getColumns(table);
    const columnList = columns.join(', ');
    const primaryKey = TABLE_PRIMARY_KEYS[table] || 'id';

    // Get the last primary key value from target
    const targetClient = await this.targetPool.connect();
    const lastKeyResult = await targetClient.query(`SELECT MAX(${primaryKey}) as last_key FROM ${table}`);
    const lastKey = lastKeyResult.rows[0].last_key;

    console.log(`  📍 Last migrated key: ${lastKey}`);

    const sourceClient = await this.sourcePool.connect();

    let bytesTransferred = 0;
    let rowsMigrated = alreadyMigrated;
    let lastUpdate = Date.now();

    try {
      // Use a query with WHERE clause to skip already migrated rows
      // This works for numeric or string primary keys
      const copyQuery = primaryKey === 'number' || primaryKey === 'id'
        ? `COPY (SELECT ${columnList} FROM ${table} WHERE ${primaryKey} > ${lastKey} ORDER BY ${primaryKey}) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\\N')`
        : `COPY (SELECT ${columnList} FROM ${table} WHERE ${primaryKey} > '${lastKey}' ORDER BY ${primaryKey}) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\\N')`;

      const copyToStream = sourceClient.query(copyTo(copyQuery));

      const copyFromStream = targetClient.query(
        copyFrom(`COPY ${table} (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '\\N')`)
      );

      await new Promise<void>((resolve, reject) => {
        copyToStream.on('error', (err: Error) => {
          console.error(`\n  ❌ Source stream error: ${err.message}`);
          reject(err);
        });
        copyFromStream.on('error', (err: Error) => {
          console.error(`\n  ❌ Target stream error: ${err.message}`);
          reject(err);
        });
        copyFromStream.on('finish', resolve);

        copyToStream.on('data', (chunk: Buffer) => {
          bytesTransferred += chunk.length;
          const newlines = chunk.toString().split('\n').length - 1;
          rowsMigrated += newlines;

          const now = Date.now();
          if (now - lastUpdate > 500) {
            const progress = Math.min(100, Math.round((rowsMigrated / totalRows) * 100));
            const elapsed = (now - startTime) / 1000;
            const newRowsMigrated = rowsMigrated - alreadyMigrated;
            const speed = elapsed > 0 ? Math.round(newRowsMigrated / elapsed) : 0;
            const remaining = totalRows - rowsMigrated;
            const eta = speed > 0 ? Math.round(remaining / speed) : 0;
            process.stdout.write(`\r  Progress: ${progress}% | ${rowsMigrated.toLocaleString()}/${totalRows.toLocaleString()} | ${speed.toLocaleString()} rows/s | ETA: ${eta}s    `);
            lastUpdate = now;
          }

          copyFromStream.write(chunk);
        });

        copyToStream.on('end', () => {
          copyFromStream.end();
        });
      });

      const duration = Date.now() - startTime;
      const newRows = rowsMigrated - alreadyMigrated;
      const avgSpeed = duration > 0 ? Math.round(newRows / (duration / 1000)) : 0;
      console.log(`\n  ✅ Resumed ${newRows.toLocaleString()} more rows | ${formatBytes(bytesTransferred)} | ${avgSpeed.toLocaleString()} rows/s`);

      // Mark as completed
      if (!this.progress.completedTables.includes(table)) {
        this.progress.completedTables.push(table);
      }
      this.progress.inProgressTable = undefined;
      this.progress.lastOffset = undefined;
      saveProgress(this.progress);

      return { table, rows: rowsMigrated, duration, bytesTransferred };
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  }

  async checkDiskSpace(): Promise<void> {
    console.log('\n💾 Checking target disk space...');
    try {
      const result = await this.targetPool.query(`
        SELECT pg_database_size(current_database()) as db_size
      `);
      console.log(`  Current database size: ${formatBytes(parseInt(result.rows[0].db_size))}`);
    } catch (error: any) {
      console.log(`  ⚠️  Could not check disk space: ${error.message}`);
    }
  }

  async migrateAll(forceRestart: boolean = false): Promise<void> {
    console.log('\n🚀 Starting COPY-based migration with RESUME support...\n');

    if (this.progress.completedTables.length > 0 && !forceRestart) {
      console.log(`📋 Previously completed tables: ${this.progress.completedTables.join(', ')}`);
      console.log(`   Last updated: ${this.progress.lastUpdated}\n`);
    }

    await this.checkDiskSpace();

    const overallStart = Date.now();

    for (const table of TABLE_ORDER) {
      try {
        const stats = await this.migrateTableWithCopy(table, forceRestart);
        this.stats.push(stats);
      } catch (error: any) {
        console.error(`\n  ❌ Failed to migrate ${table}:`, error.message);

        // Save progress even on failure
        if (this.progress.inProgressTable === table) {
          // Don't remove from in-progress, so we know where we stopped
          saveProgress(this.progress);
        }

        this.stats.push({ table, rows: 0, duration: 0, bytesTransferred: 0 });

        // Ask user if they want to continue
        console.log(`\n  ⚠️  Migration stopped at ${table}. Fix the issue and run again to resume.`);
        break; // Stop migration on first error
      }
    }

    const overallDuration = Date.now() - overallStart;
    this.printSummary(overallDuration);
  }

  private printSummary(totalDuration: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));

    let totalRows = 0;
    let totalBytes = 0;
    let skippedTables = 0;

    for (const stat of this.stats) {
      if (stat.skipped) {
        skippedTables++;
        continue;
      }

      totalRows += stat.rows;
      totalBytes += stat.bytesTransferred;

      if (stat.rows > 0) {
        console.log(`\n${stat.table}:`);
        console.log(`  Rows: ${stat.rows.toLocaleString()} | Data: ${formatBytes(stat.bytesTransferred)} | Time: ${formatTime(stat.duration)}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📈 SESSION TOTALS:`);
    console.log(`  Tables Processed: ${this.stats.length - skippedTables}`);
    console.log(`  Tables Skipped: ${skippedTables}`);
    console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
    console.log(`  Total Data: ${formatBytes(totalBytes)}`);
    console.log(`  Total Time: ${formatTime(totalDuration)}`);
    if (totalDuration > 0) {
      console.log(`  Avg Speed: ${Math.round(totalRows / (totalDuration / 1000)).toLocaleString()} rows/s`);
    }

    console.log(`\n📋 OVERALL PROGRESS:`);
    console.log(`  Completed Tables: ${this.progress.completedTables.length}/${TABLE_ORDER.length}`);
    console.log(`  Remaining: ${TABLE_ORDER.filter(t => !this.progress.completedTables.includes(t)).join(', ') || 'None'}`);
    console.log('\n' + '='.repeat(60));
  }

  async close(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   PostgreSQL COPY Stream Migration (RESUMABLE VERSION)    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const migrator = new ResumableCopyMigrator();

  try {
    const connected = await migrator.testConnections();
    if (!connected) {
      process.exit(1);
    }

    const args = process.argv.slice(2);
    const forceRestart = args.includes('--restart');
    const resetProgress = args.includes('--reset');

    if (resetProgress) {
      console.log('\n🗑️  Resetting migration progress...');
      if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
        console.log('  ✅ Progress file deleted');
      }
    }

    await migrator.migrateAll(forceRestart);

    console.log('\n✅ Migration session complete!\n');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

if (process.argv.includes('--help')) {
  console.log(`
PostgreSQL COPY Stream Migration (RESUMABLE VERSION)

Uses PostgreSQL's native COPY protocol with resume capability.
Automatically skips completed tables and resumes incomplete ones.

Usage:
  npx tsx migrate-copy-resume.ts [options]

Options:
  --restart  Force restart all tables (ignore previous progress)
  --reset    Delete progress file and start fresh
  --help     Show this help

Progress is saved to: ${PROGRESS_FILE}

Features:
- Skips already completed tables
- Resumes incomplete tables from last row
- Tracks progress in JSON file
- Survives connection failures
`);
  process.exit(0);
}

main().catch(console.error);
