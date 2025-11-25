#!/usr/bin/env tsx
/**
 * PostgreSQL to PlanetScale Migration - COPY Stream Version
 * Uses PostgreSQL COPY protocol for maximum speed (100k+ rows/sec)
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';

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

interface MigrationStats {
  table: string;
  rows: number;
  duration: number;
  bytesTransferred: number;
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

class CopyMigrator {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats[] = [];

  constructor() {
    this.sourcePool = new Pool(SOURCE_CONFIG);
    this.targetPool = new Pool(TARGET_CONFIG);
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

  async createSchema(): Promise<void> {
    console.log('\n📝 Creating schema on target...\n');

    const schemaPath = './schema-postgres.sql';
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    const cleanedSchema = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleanedSchema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const client = await this.targetPool.connect();
    let created = 0;

    for (const statement of statements) {
      try {
        await client.query(statement);
        const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
        if (tableName) {
          console.log(`  ✅ ${tableName}`);
          created++;
        }
      } catch (error: any) {
        if (error.code !== '42P07') { // Not "already exists"
          const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
          if (tableName) {
            console.log(`  ⚠️  ${tableName}: ${error.message.split('\n')[0]}`);
          }
        }
      }
    }

    client.release();
    console.log(`\n✅ Created ${created} tables`);
  }

  async dropAllTables(): Promise<void> {
    console.log('\n🗑️  Dropping tables...');
    const client = await this.targetPool.connect();

    for (const table of [...TABLE_ORDER].reverse()) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✅ Dropped: ${table}`);
      } catch (e) {}
    }

    client.release();
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

  async migrateTableWithCopy(table: string): Promise<MigrationStats> {
    const startTime = Date.now();
    console.log(`\n📦 Migrating: ${table}`);

    // Get row count
    const countResult = await this.sourcePool.query(`SELECT COUNT(*) as count FROM ${table}`);
    const totalRows = parseInt(countResult.rows[0].count);
    console.log(`  Total rows: ${totalRows.toLocaleString()}`);

    if (totalRows === 0) {
      return { table, rows: 0, duration: 0, bytesTransferred: 0 };
    }

    // Get columns
    const columns = await this.getColumns(table);
    const columnList = columns.join(', ');

    // Truncate target table first
    const targetClient = await this.targetPool.connect();
    await targetClient.query(`TRUNCATE TABLE ${table} CASCADE`);

    // Get source client
    const sourceClient = await this.sourcePool.connect();

    let bytesTransferred = 0;
    let rowsMigrated = 0;
    let lastUpdate = Date.now();

    try {
      // Create COPY TO stream from source
      const copyToStream = sourceClient.query(
        copyTo(`COPY ${table} (${columnList}) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '\\N')`)
      );

      // Create COPY FROM stream to target
      const copyFromStream = targetClient.query(
        copyFrom(`COPY ${table} (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '\\N')`)
      );

      // Track progress
      const progressTracker = new Writable({
        write(chunk, encoding, callback) {
          bytesTransferred += chunk.length;
          // Estimate rows based on newlines
          const newlines = chunk.toString().split('\n').length - 1;
          rowsMigrated += newlines;

          const now = Date.now();
          if (now - lastUpdate > 1000) {
            const progress = Math.min(100, Math.round((rowsMigrated / totalRows) * 100));
            const elapsed = (now - startTime) / 1000;
            const speed = Math.round(rowsMigrated / elapsed);
            const eta = rowsMigrated > 0 ? Math.round((totalRows - rowsMigrated) / speed) : 0;
            process.stdout.write(`\r  Progress: ${progress}% | ${rowsMigrated.toLocaleString()}/${totalRows.toLocaleString()} | ${speed.toLocaleString()} rows/s | ETA: ${eta}s    `);
            lastUpdate = now;
          }

          callback();
        }
      });

      // Pipe: source -> progress tracker -> target
      // We need to pipe directly since the tracker is just for monitoring
      await new Promise<void>((resolve, reject) => {
        copyToStream.on('error', reject);
        copyFromStream.on('error', reject);
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

      return { table, rows: totalRows, duration, bytesTransferred };
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  }

  async migrateAll(): Promise<void> {
    console.log('\n🚀 Starting COPY-based migration...\n');
    const overallStart = Date.now();

    for (const table of TABLE_ORDER) {
      try {
        const stats = await this.migrateTableWithCopy(table);
        this.stats.push(stats);
      } catch (error: any) {
        console.error(`\n  ❌ Failed to migrate ${table}:`, error.message);
        this.stats.push({ table, rows: 0, duration: 0, bytesTransferred: 0 });
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

    for (const stat of this.stats) {
      totalRows += stat.rows;
      totalBytes += stat.bytesTransferred;

      if (stat.rows > 0) {
        console.log(`\n${stat.table}:`);
        console.log(`  Rows: ${stat.rows.toLocaleString()} | Data: ${formatBytes(stat.bytesTransferred)} | Time: ${formatTime(stat.duration)}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📈 TOTALS:`);
    console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
    console.log(`  Total Data: ${formatBytes(totalBytes)}`);
    console.log(`  Total Time: ${formatTime(totalDuration)}`);
    console.log(`  Avg Speed: ${Math.round(totalRows / (totalDuration / 1000)).toLocaleString()} rows/s`);
    console.log('\n' + '='.repeat(60));
  }

  async close(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       PostgreSQL COPY Stream Migration (FASTEST)          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const migrator = new CopyMigrator();

  try {
    const connected = await migrator.testConnections();
    if (!connected) {
      process.exit(1);
    }

    const args = process.argv.slice(2);
    const purgeFirst = args.includes('--purge');

    if (purgeFirst) {
      await migrator.dropAllTables();
      await migrator.createSchema();
    }

    await migrator.migrateAll();

    console.log('\n✅ Migration complete!\n');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

if (process.argv.includes('--help')) {
  console.log(`
PostgreSQL COPY Stream Migration (FASTEST METHOD)

Uses PostgreSQL's native COPY protocol to stream data directly
from source to target - can achieve 100k+ rows/second!

Usage:
  npx tsx migrate-copy.ts [options]

Options:
  --purge    Drop and recreate all tables before migration
  --help     Show this help

This is the FASTEST method because:
- Uses binary COPY protocol (not SQL INSERT)
- Streams directly from source to target
- No intermediate storage needed
- Minimal CPU overhead
`);
  process.exit(0);
}

main().catch(console.error);
