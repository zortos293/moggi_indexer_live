#!/usr/bin/env tsx
/**
 * PostgreSQL to PlanetScale Migration Tool
 * Migrates data from local PostgreSQL to PlanetScale (PostgreSQL compatible)
 */

import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

// Load .env file manually
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

// Configuration - Source (local PostgreSQL)
const PG_CONFIG = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max: 20, // Increased pool size
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
};

// Configuration - Target (PlanetScale PostgreSQL)
const PLANETSCALE_CONFIG = {
  host: process.env.PLANETSCALE_HOST || '',
  port: parseInt(process.env.PLANETSCALE_PORT || '5432'),
  database: process.env.PLANETSCALE_DATABASE || 'postgres',
  user: process.env.PLANETSCALE_USER || '',
  password: process.env.PLANETSCALE_PASSWORD || '',
  max: 20, // Increased pool size
  ssl: {
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 60000,
  idleTimeoutMillis: 60000,
  statement_timeout: 0, // No timeout for long operations
};

// Batch sizes for different tables (optimized for bulk inserts)
const BATCH_SIZES: Record<string, number> = {
  blocks: 50000,
  transactions: 20000,
  logs: 50000,
  contracts: 50000,
  erc20_tokens: 50000,
  erc721_tokens: 50000,
  erc1155_tokens: 50000,
  addresses: 50000,
  address_transactions: 100000,
  erc20_transfers: 50000,
  erc721_transfers: 50000,
  erc1155_transfers: 50000,
  indexer_state: 1000,
};

// Number of rows per bulk INSERT statement
const BULK_INSERT_SIZE = 2000;

// Number of parallel insert operations
const PARALLEL_INSERTS = 10;

// Table order for migration (respects logical dependencies)
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
  totalRows: number;
  migratedRows: number;
  errors: number;
  duration: number;
}

class PlanetScaleMigrator {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: MigrationStats[] = [];
  private rl: readline.Interface;

  constructor() {
    this.sourcePool = new Pool(PG_CONFIG);
    this.targetPool = new Pool(PLANETSCALE_CONFIG);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  async testConnections(): Promise<boolean> {
    console.log('\n📡 Testing database connections...\n');

    // Test Source PostgreSQL
    try {
      const sourceClient = await this.sourcePool.connect();
      const sourceResult = await sourceClient.query('SELECT version()');
      console.log('✅ Source PostgreSQL connected:', sourceResult.rows[0].version.split(',')[0]);
      sourceClient.release();
    } catch (error) {
      console.error('❌ Source PostgreSQL connection failed:', error);
      return false;
    }

    // Test Target PlanetScale
    try {
      const targetClient = await this.targetPool.connect();
      const targetResult = await targetClient.query('SELECT version()');
      console.log('✅ PlanetScale connected:', targetResult.rows[0].version.split(',')[0]);
      targetClient.release();
    } catch (error) {
      console.error('❌ PlanetScale connection failed:', error);
      console.error('\nMake sure you have set these environment variables:');
      console.error('  PLANETSCALE_HOST - Your PlanetScale host');
      console.error('  PLANETSCALE_DATABASE - Your database name');
      console.error('  PLANETSCALE_USER - Your username');
      console.error('  PLANETSCALE_PASSWORD - Your password');
      return false;
    }

    return true;
  }

  async createSchema(): Promise<void> {
    console.log('\n📝 Creating PlanetScale schema...\n');

    const schemaPath = './schema-postgres.sql';
    if (!fs.existsSync(schemaPath)) {
      throw new Error('schema-postgres.sql not found');
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Remove comments and split by semicolon
    const cleanedSchema = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = cleanedSchema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`  Found ${statements.length} SQL statements to execute`);

    const client = await this.targetPool.connect();

    let created = 0;
    for (const statement of statements) {
      try {
        await client.query(statement);
        const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
        if (tableName) {
          console.log(`  ✅ Created table: ${tableName}`);
          created++;
        }
      } catch (error: any) {
        if (error.code === '42P07') { // Table already exists
          const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
          console.log(`  ⚠️  Table already exists: ${tableName}`);
        } else if (error.message?.includes('already exists')) {
          // Index already exists, skip
        } else {
          console.error(`  ❌ Error executing statement:`, error.message);
          console.error(`     Statement preview: ${statement.substring(0, 100)}...`);
        }
      }
    }

    client.release();
    console.log(`\n✅ Schema creation complete (${created} tables created)`);
  }

  async getTableCount(table: string): Promise<{ source: number; target: number }> {
    const sourceResult = await this.sourcePool.query(`SELECT COUNT(*) as count FROM ${table}`);
    const sourceCount = parseInt(sourceResult.rows[0].count);

    const targetResult = await this.targetPool.query(`SELECT COUNT(*) as count FROM ${table}`);
    const targetCount = parseInt(targetResult.rows[0].count);

    return { source: sourceCount, target: targetCount };
  }

  async migrateTable(table: string, skipExisting: boolean = true): Promise<MigrationStats> {
    const startTime = Date.now();
    const batchSize = BATCH_SIZES[table] || 50000;

    console.log(`\n📦 Migrating table: ${table}`);

    // Get total count from source
    const counts = await this.getTableCount(table);
    console.log(`  Source rows: ${counts.source.toLocaleString()}`);
    console.log(`  Target rows: ${counts.target.toLocaleString()}`);

    if (skipExisting && counts.target > 0) {
      console.log(`  ⚠️  Table already has data. Skipping...`);
      return {
        table,
        totalRows: counts.source,
        migratedRows: 0,
        errors: 0,
        duration: Date.now() - startTime,
      };
    }

    if (counts.source === 0) {
      console.log(`  ℹ️  No data to migrate`);
      return {
        table,
        totalRows: 0,
        migratedRows: 0,
        errors: 0,
        duration: Date.now() - startTime,
      };
    }

    // Get columns
    const columnsResult = await this.sourcePool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    const columns = columnsResult.rows.map(r => r.column_name);

    let migratedRows = 0;
    let errors = 0;
    let lastProgressUpdate = Date.now();

    const conflictKey = this.getPrimaryKeyForConflict(table);
    const primaryKey = this.getPrimaryKey(table);

    // Disable indexes on target for faster inserts
    console.log(`  ⏳ Disabling indexes for faster insert...`);
    const indexesResult = await this.targetPool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = $1 AND indexname NOT LIKE '%_pkey'
    `, [table]);

    // Drop non-primary indexes temporarily
    for (const idx of indexesResult.rows) {
      try {
        await this.targetPool.query(`DROP INDEX IF EXISTS ${idx.indexname}`);
      } catch (e) {
        // Ignore errors
      }
    }

    // Helper function to insert a chunk of rows
    const insertChunk = async (chunk: any[]): Promise<number> => {
      const valueSets: string[] = [];
      const allValues: any[] = [];
      let paramIndex = 1;

      for (const row of chunk) {
        const placeholders = columns.map(() => `$${paramIndex++}`).join(', ');
        valueSets.push(`(${placeholders})`);
        for (const col of columns) {
          allValues.push(row[col]);
        }
      }

      const bulkInsertQuery = `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES ${valueSets.join(', ')}
        ON CONFLICT (${conflictKey}) DO NOTHING
      `;

      await this.targetPool.query(bulkInsertQuery, allValues);
      return chunk.length;
    };

    // Use cursor-based pagination (much faster than OFFSET for large tables)
    let lastKey: any = null;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch from source using cursor-based pagination
      let selectQuery: string;
      let params: any[] = [];

      if (primaryKey.includes(',')) {
        // Composite key - fallback to offset-based for simplicity
        const offset = migratedRows;
        selectQuery = `SELECT * FROM ${table} ORDER BY ${primaryKey} LIMIT ${batchSize} OFFSET ${offset}`;
      } else if (lastKey === null) {
        selectQuery = `SELECT * FROM ${table} ORDER BY ${primaryKey} LIMIT ${batchSize}`;
      } else {
        selectQuery = `SELECT * FROM ${table} WHERE ${primaryKey} > $1 ORDER BY ${primaryKey} LIMIT ${batchSize}`;
        params = [lastKey];
      }

      const sourceBatch = await this.sourcePool.query(selectQuery, params);

      if (sourceBatch.rows.length === 0) {
        hasMore = false;
        break;
      }

      // Update cursor for next iteration
      if (!primaryKey.includes(',')) {
        lastKey = sourceBatch.rows[sourceBatch.rows.length - 1][primaryKey];
      }

      // Split into chunks for parallel processing
      const chunks: any[][] = [];
      for (let i = 0; i < sourceBatch.rows.length; i += BULK_INSERT_SIZE) {
        chunks.push(sourceBatch.rows.slice(i, i + BULK_INSERT_SIZE));
      }

      // Process chunks in parallel batches
      for (let i = 0; i < chunks.length; i += PARALLEL_INSERTS) {
        const parallelChunks = chunks.slice(i, i + PARALLEL_INSERTS);
        const promises = parallelChunks.map(async (chunk) => {
          try {
            return await insertChunk(chunk);
          } catch (error: any) {
            errors++;
            if (errors <= 5) {
              console.error(`\n  ❌ Error bulk inserting:`, error.message);
            }
            return 0;
          }
        });

        const results = await Promise.all(promises);
        migratedRows += results.reduce((a, b) => a + b, 0);
      }

      // Check if we got less than batch size (means we're done)
      if (sourceBatch.rows.length < batchSize) {
        hasMore = false;
      }

      // Update progress every 500ms to avoid console spam
      const now = Date.now();
      if (now - lastProgressUpdate > 500 || !hasMore) {
        const progress = Math.min(100, Math.round((migratedRows / counts.source) * 100));
        const elapsed = (now - startTime) / 1000;
        const rowsPerSec = Math.round(migratedRows / elapsed);
        const eta = migratedRows > 0 ? Math.round((counts.source - migratedRows) / rowsPerSec) : 0;
        process.stdout.write(`\r  Progress: ${progress}% (${migratedRows.toLocaleString()}/${counts.source.toLocaleString()}) | ${rowsPerSec.toLocaleString()} rows/s | ETA: ${eta}s    `);
        lastProgressUpdate = now;
      }
    }

    // Recreate indexes
    console.log(`\n  ⏳ Recreating indexes...`);
    const schemaPath = './schema-postgres.sql';
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      const indexPattern = new RegExp(`CREATE\\s+INDEX.*?ON\\s+${table}\\s*\\([^)]+\\)`, 'gi');
      const indexes = schema.match(indexPattern) || [];
      for (const indexStmt of indexes) {
        try {
          await this.targetPool.query(indexStmt);
        } catch (e) {
          // Index might already exist
        }
      }
    }

    const duration = Date.now() - startTime;
    const avgSpeed = Math.round(migratedRows / (duration / 1000));
    console.log(`  ✅ Migrated ${migratedRows.toLocaleString()} rows (${errors} errors) | Avg: ${avgSpeed.toLocaleString()} rows/s`);

    return {
      table,
      totalRows: counts.source,
      migratedRows,
      errors,
      duration,
    };
  }

  private getPrimaryKey(table: string): string {
    switch (table) {
      case 'blocks':
        return 'number';
      case 'transactions':
        return 'hash';
      case 'logs':
      case 'erc20_transfers':
      case 'erc721_transfers':
      case 'erc1155_transfers':
        return 'id';
      case 'contracts':
      case 'erc20_tokens':
      case 'erc721_tokens':
      case 'erc1155_tokens':
      case 'addresses':
        return 'address';
      case 'address_transactions':
        return 'address, transaction_hash';
      case 'indexer_state':
        return 'id';
      default:
        return 'id';
    }
  }

  private getPrimaryKeyForConflict(table: string): string {
    // Same as getPrimaryKey but formatted for ON CONFLICT clause
    return this.getPrimaryKey(table);
  }

  async migrateAll(skipExisting: boolean = true): Promise<void> {
    console.log('\n🚀 Starting full migration...\n');
    const overallStart = Date.now();

    for (const table of TABLE_ORDER) {
      const stats = await this.migrateTable(table, skipExisting);
      this.stats.push(stats);
    }

    const overallDuration = Date.now() - overallStart;
    this.printSummary(overallDuration);
  }

  private printSummary(totalDuration: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));

    let totalRows = 0;
    let totalMigrated = 0;
    let totalErrors = 0;

    for (const stat of this.stats) {
      totalRows += stat.totalRows;
      totalMigrated += stat.migratedRows;
      totalErrors += stat.errors;

      console.log(`\n${stat.table}:`);
      console.log(`  Total: ${stat.totalRows.toLocaleString()} | Migrated: ${stat.migratedRows.toLocaleString()} | Errors: ${stat.errors}`);
      console.log(`  Duration: ${(stat.duration / 1000).toFixed(2)}s`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📈 TOTALS:`);
    console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
    console.log(`  Migrated: ${totalMigrated.toLocaleString()}`);
    console.log(`  Errors: ${totalErrors.toLocaleString()}`);
    console.log(`  Total Duration: ${(totalDuration / 1000 / 60).toFixed(2)} minutes`);
    console.log('\n' + '='.repeat(60));
  }

  async clearPlanetScale(): Promise<void> {
    console.log('\n⚠️  Clearing all PlanetScale tables...');

    const client = await this.targetPool.connect();

    // Reverse order to avoid FK issues
    const reversedTables = [...TABLE_ORDER].reverse();

    for (const table of reversedTables) {
      try {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`  ✅ Cleared: ${table}`);
      } catch (error: any) {
        console.error(`  ❌ Error clearing ${table}:`, error.message);
      }
    }

    client.release();
  }

  async purgePlanetScale(): Promise<void> {
    console.log('\n🗑️  PURGING all PlanetScale tables (DROP + RECREATE)...\n');

    const client = await this.targetPool.connect();

    // Drop all tables in reverse order
    const reversedTables = [...TABLE_ORDER].reverse();

    console.log('Dropping tables...');
    for (const table of reversedTables) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✅ Dropped: ${table}`);
      } catch (error: any) {
        console.error(`  ❌ Error dropping ${table}:`, error.message);
      }
    }

    client.release();

    console.log('\nRecreating schema...');
    await this.createSchema();

    console.log('\n✅ Database purged and schema recreated!');
  }

  async close(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
    this.rl.close();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         PostgreSQL to PlanetScale Migration Tool          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const migrator = new PlanetScaleMigrator();

  try {
    // Test connections
    const connected = await migrator.testConnections();
    if (!connected) {
      console.error('\n❌ Failed to connect to databases. Exiting.');
      process.exit(1);
    }

    // Parse arguments
    const args = process.argv.slice(2);
    const skipSchema = args.includes('--skip-schema');
    const clearFirst = args.includes('--clear');
    const purgeFirst = args.includes('--purge');
    const forceOverwrite = args.includes('--force');
    const singleTable = args.find(a => a.startsWith('--table='))?.split('=')[1];
    const purgeOnly = args.includes('--purge-only');

    // Purge only mode
    if (purgeOnly) {
      await migrator.purgePlanetScale();
      console.log('\n✅ Purge complete!\n');
      return;
    }

    // Purge if requested (drops and recreates all tables)
    if (purgeFirst) {
      await migrator.purgePlanetScale();
    } else if (!skipSchema) {
      // Create schema if needed
      await migrator.createSchema();
    }

    // Clear data if requested (truncate without dropping)
    if (clearFirst && !purgeFirst) {
      await migrator.clearPlanetScale();
    }

    // Migrate
    if (singleTable) {
      console.log(`\n🎯 Migrating single table: ${singleTable}`);
      await migrator.migrateTable(singleTable, !forceOverwrite);
    } else {
      await migrator.migrateAll(!forceOverwrite);
    }

    console.log('\n✅ Migration complete!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

// Usage information
if (process.argv.includes('--help')) {
  console.log(`
PostgreSQL to PlanetScale Migration Tool

Usage:
  npx tsx migrate-to-planetscale.ts [options]

Options:
  --skip-schema    Skip creating schema (if tables already exist)
  --clear          Clear all PlanetScale data before migration (TRUNCATE)
  --purge          Drop and recreate all tables before migration
  --purge-only     Only purge the database (drop + recreate schema), no migration
  --force          Overwrite existing data (don't skip tables with data)
  --table=<name>   Migrate only a specific table
  --help           Show this help message

Environment Variables:
  PostgreSQL (source):
    PG_HOST          PostgreSQL host (default: localhost)
    PG_PORT          PostgreSQL port (default: 5432)
    PG_DATABASE      PostgreSQL database (default: postgres)
    PG_USER          PostgreSQL user (default: postgres)
    PG_PASSWORD      PostgreSQL password

  PlanetScale (target):
    PLANETSCALE_HOST       PlanetScale host (required)
    PLANETSCALE_PORT       PlanetScale port (default: 5432)
    PLANETSCALE_DATABASE   PlanetScale database name (required)
    PLANETSCALE_USER       PlanetScale username (required)
    PLANETSCALE_PASSWORD   PlanetScale password (required)

Examples:
  # Full migration
  npx tsx migrate-to-planetscale.ts

  # Migrate specific table
  npx tsx migrate-to-planetscale.ts --table=blocks

  # Clear and re-migrate
  npx tsx migrate-to-planetscale.ts --clear --force

  # Purge database (wipe clean) and migrate
  npx tsx migrate-to-planetscale.ts --purge --force

  # Only purge database (no migration)
  npx tsx migrate-to-planetscale.ts --purge-only

  # Skip schema creation (tables already exist)
  npx tsx migrate-to-planetscale.ts --skip-schema
`);
  process.exit(0);
}

main().catch(console.error);
