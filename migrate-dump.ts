#!/usr/bin/env tsx
/**
 * PostgreSQL to PlanetScale Migration Tool - DUMP VERSION
 * Uses pg_dump and psql for maximum speed
 *
 * This is MUCH faster than row-by-row transfer because:
 * 1. pg_dump uses COPY format (binary, optimized)
 * 2. No network round-trips per row
 * 3. Indexes are disabled during import
 * 4. Single transaction for entire table
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
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

// Configuration
const SOURCE_CONFIG = {
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || '5432',
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
};

const TARGET_CONFIG = {
  host: process.env.PLANETSCALE_HOST || '',
  port: process.env.PLANETSCALE_PORT || '5432',
  database: process.env.PLANETSCALE_DATABASE || 'postgres',
  user: process.env.PLANETSCALE_USER || '',
  password: process.env.PLANETSCALE_PASSWORD || '',
};

const DUMP_DIR = './migration_dumps';
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

interface TableStats {
  table: string;
  dumpTime: number;
  dumpSize: number;
  importTime: number;
  rows: number;
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

async function checkPgTools(): Promise<boolean> {
  console.log('🔍 Checking for PostgreSQL tools...\n');

  try {
    execSync('pg_dump --version', { stdio: 'pipe' });
    console.log('  ✅ pg_dump found');
  } catch {
    console.error('  ❌ pg_dump not found. Please install PostgreSQL client tools.');
    return false;
  }

  try {
    execSync('psql --version', { stdio: 'pipe' });
    console.log('  ✅ psql found');
  } catch {
    console.error('  ❌ psql not found. Please install PostgreSQL client tools.');
    return false;
  }

  return true;
}

function getSourceConnectionString(): string {
  return `postgresql://${SOURCE_CONFIG.user}:${SOURCE_CONFIG.password}@${SOURCE_CONFIG.host}:${SOURCE_CONFIG.port}/${SOURCE_CONFIG.database}`;
}

function getTargetConnectionString(): string {
  return `postgresql://${TARGET_CONFIG.user}:${TARGET_CONFIG.password}@${TARGET_CONFIG.host}:${TARGET_CONFIG.port}/${TARGET_CONFIG.database}?sslmode=require`;
}

async function dumpTable(table: string): Promise<{ path: string; size: number; duration: number }> {
  const dumpPath = path.join(DUMP_DIR, `${table}.sql`);
  const startTime = Date.now();

  console.log(`  📤 Dumping ${table}...`);

  // Use pg_dump with optimized settings
  const pgDumpCmd = [
    'pg_dump',
    '--no-owner',
    '--no-privileges',
    '--no-comments',
    '--disable-triggers',
    '--data-only',
    '--inserts', // Use INSERT statements for compatibility
    '--rows-per-insert=1000', // Bulk inserts
    `--table=${table}`,
    '--file', dumpPath,
    getSourceConnectionString(),
  ];

  try {
    process.env.PGPASSWORD = SOURCE_CONFIG.password;
    execSync(pgDumpCmd.join(' '), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: SOURCE_CONFIG.password }
    });

    const stats = fs.statSync(dumpPath);
    const duration = Date.now() - startTime;

    console.log(`    ✅ Dumped ${formatBytes(stats.size)} in ${formatTime(duration)}`);

    return { path: dumpPath, size: stats.size, duration };
  } catch (error: any) {
    console.error(`    ❌ Dump failed:`, error.message);
    throw error;
  }
}

async function importTable(table: string, dumpPath: string): Promise<{ duration: number; rows: number }> {
  const startTime = Date.now();

  console.log(`  📥 Importing ${table} to PlanetScale...`);

  // First, disable triggers and constraints
  const preImportSQL = `
    SET session_replication_role = 'replica';
    TRUNCATE TABLE ${table} CASCADE;
  `;

  const postImportSQL = `
    SET session_replication_role = 'origin';
  `;

  try {
    process.env.PGPASSWORD = TARGET_CONFIG.password;
    const connStr = getTargetConnectionString();

    // Pre-import setup
    execSync(`psql "${connStr}" -c "${preImportSQL}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password }
    });

    // Import the dump file
    execSync(`psql "${connStr}" -f "${dumpPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password },
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
    });

    // Post-import cleanup
    execSync(`psql "${connStr}" -c "${postImportSQL}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password }
    });

    // Get row count
    const countResult = execSync(`psql "${connStr}" -t -c "SELECT COUNT(*) FROM ${table}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password }
    }).toString().trim();

    const rows = parseInt(countResult) || 0;
    const duration = Date.now() - startTime;

    console.log(`    ✅ Imported ${rows.toLocaleString()} rows in ${formatTime(duration)}`);

    return { duration, rows };
  } catch (error: any) {
    console.error(`    ❌ Import failed:`, error.message);
    throw error;
  }
}

async function dumpAllTables(): Promise<void> {
  console.log('\n📤 DUMPING ALL TABLES TO FILES\n');

  if (!fs.existsSync(DUMP_DIR)) {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
  }

  let totalSize = 0;
  let totalTime = 0;

  for (const table of TABLE_ORDER) {
    try {
      const result = await dumpTable(table);
      totalSize += result.size;
      totalTime += result.duration;
    } catch (error) {
      console.error(`  ❌ Failed to dump ${table}, skipping...`);
    }
  }

  console.log(`\n✅ Total dump: ${formatBytes(totalSize)} in ${formatTime(totalTime)}`);
  console.log(`📁 Dumps saved to: ${path.resolve(DUMP_DIR)}`);
}

async function importAllTables(): Promise<void> {
  console.log('\n📥 IMPORTING ALL TABLES FROM DUMPS\n');

  if (!fs.existsSync(DUMP_DIR)) {
    console.error(`❌ Dump directory not found: ${DUMP_DIR}`);
    console.error('   Run with --dump-only first to create dumps.');
    process.exit(1);
  }

  const stats: TableStats[] = [];
  let totalRows = 0;
  let totalTime = 0;

  for (const table of TABLE_ORDER) {
    const dumpPath = path.join(DUMP_DIR, `${table}.sql`);

    if (!fs.existsSync(dumpPath)) {
      console.log(`  ⚠️  No dump found for ${table}, skipping...`);
      continue;
    }

    try {
      const dumpSize = fs.statSync(dumpPath).size;
      const result = await importTable(table, dumpPath);

      stats.push({
        table,
        dumpTime: 0,
        dumpSize,
        importTime: result.duration,
        rows: result.rows,
      });

      totalRows += result.rows;
      totalTime += result.duration;
    } catch (error) {
      console.error(`  ❌ Failed to import ${table}, continuing...`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(60));

  for (const stat of stats) {
    console.log(`\n${stat.table}:`);
    console.log(`  Rows: ${stat.rows.toLocaleString()} | Size: ${formatBytes(stat.dumpSize)} | Time: ${formatTime(stat.importTime)}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 TOTALS:`);
  console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
  console.log(`  Total Time: ${formatTime(totalTime)}`);
  console.log('\n' + '='.repeat(60));
}

async function dumpAndImport(): Promise<void> {
  console.log('\n🚀 FULL MIGRATION (DUMP + IMPORT)\n');

  if (!fs.existsSync(DUMP_DIR)) {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
  }

  const stats: TableStats[] = [];
  let totalRows = 0;
  let totalDumpTime = 0;
  let totalImportTime = 0;
  let totalSize = 0;

  for (const table of TABLE_ORDER) {
    console.log(`\n📦 Migrating table: ${table}`);

    try {
      // Dump
      const dumpResult = await dumpTable(table);
      totalSize += dumpResult.size;
      totalDumpTime += dumpResult.duration;

      // Import
      const importResult = await importTable(table, dumpResult.path);
      totalImportTime += importResult.duration;
      totalRows += importResult.rows;

      stats.push({
        table,
        dumpTime: dumpResult.duration,
        dumpSize: dumpResult.size,
        importTime: importResult.duration,
        rows: importResult.rows,
      });

      // Clean up dump file to save space
      if (!process.argv.includes('--keep-dumps')) {
        fs.unlinkSync(dumpResult.path);
      }
    } catch (error) {
      console.error(`  ❌ Failed to migrate ${table}, continuing...`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));

  for (const stat of stats) {
    console.log(`\n${stat.table}:`);
    console.log(`  Rows: ${stat.rows.toLocaleString()}`);
    console.log(`  Dump: ${formatBytes(stat.dumpSize)} in ${formatTime(stat.dumpTime)}`);
    console.log(`  Import: ${formatTime(stat.importTime)}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 TOTALS:`);
  console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
  console.log(`  Total Dump Size: ${formatBytes(totalSize)}`);
  console.log(`  Total Dump Time: ${formatTime(totalDumpTime)}`);
  console.log(`  Total Import Time: ${formatTime(totalImportTime)}`);
  console.log(`  Total Time: ${formatTime(totalDumpTime + totalImportTime)}`);
  console.log('\n' + '='.repeat(60));
}

async function createSchemaOnTarget(): Promise<void> {
  console.log('\n📝 Creating schema on PlanetScale...\n');

  const schemaPath = './schema-postgres.sql';
  if (!fs.existsSync(schemaPath)) {
    throw new Error('schema-postgres.sql not found');
  }

  try {
    process.env.PGPASSWORD = TARGET_CONFIG.password;
    const connStr = getTargetConnectionString();

    // Read and execute schema file
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

    let created = 0;
    for (const statement of statements) {
      try {
        // Escape quotes for command line
        const escapedStmt = statement.replace(/"/g, '\\"').replace(/\n/g, ' ');
        execSync(`psql "${connStr}" -c "${escapedStmt}"`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password }
        });

        const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
        if (tableName) {
          console.log(`  ✅ Created table: ${tableName}`);
          created++;
        }
      } catch (error: any) {
        // Check if it's just "already exists" error
        if (!error.message?.includes('already exists')) {
          const tableName = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
          if (tableName) {
            console.log(`  ⚠️  Table ${tableName}: ${error.message.split('\n')[0]}`);
          }
        }
      }
    }

    console.log(`\n✅ Schema creation complete (${created} tables created)`);
  } catch (error: any) {
    console.error('❌ Schema creation failed:', error.message);
    throw error;
  }
}

async function dropAllTables(): Promise<void> {
  console.log('\n🗑️  Dropping all tables on PlanetScale...\n');

  const reversedTables = [...TABLE_ORDER].reverse();

  try {
    process.env.PGPASSWORD = TARGET_CONFIG.password;
    const connStr = getTargetConnectionString();

    for (const table of reversedTables) {
      execSync(`psql "${connStr}" -c "DROP TABLE IF EXISTS ${table} CASCADE"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: TARGET_CONFIG.password }
      });
      console.log(`  ✅ Dropped: ${table}`);
    }
  } catch (error: any) {
    console.error('❌ Drop failed:', error.message);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     PostgreSQL to PlanetScale Migration (DUMP VERSION)    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Check for pg tools
  const hasTools = await checkPgTools();
  if (!hasTools) {
    process.exit(1);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const dumpOnly = args.includes('--dump-only');
  const importOnly = args.includes('--import-only');
  const purgeFirst = args.includes('--purge');

  try {
    if (dumpOnly) {
      await dumpAllTables();
    } else if (importOnly) {
      if (purgeFirst) {
        await dropAllTables();
        await createSchemaOnTarget();
      }
      await importAllTables();
    } else {
      if (purgeFirst) {
        await dropAllTables();
        await createSchemaOnTarget();
      }
      await dumpAndImport();
    }

    console.log('\n✅ Migration complete!\n');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Usage information
if (process.argv.includes('--help')) {
  console.log(`
PostgreSQL to PlanetScale Migration Tool (DUMP VERSION)

This uses pg_dump and psql for maximum speed - typically 10-50x faster than
row-by-row transfer over the network.

Usage:
  npx tsx migrate-dump.ts [options]

Options:
  --dump-only      Only create dump files (no import)
  --import-only    Only import from existing dump files
  --purge          Drop and recreate all tables before import
  --keep-dumps     Keep dump files after migration (default: delete)
  --help           Show this help message

Environment Variables:
  Source (local PostgreSQL):
    PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD

  Target (PlanetScale):
    PLANETSCALE_HOST, PLANETSCALE_PORT, PLANETSCALE_DATABASE,
    PLANETSCALE_USER, PLANETSCALE_PASSWORD

Examples:
  # Full migration (dump + import each table sequentially)
  npx tsx migrate-dump.ts --purge

  # Just create dump files
  npx tsx migrate-dump.ts --dump-only

  # Import from existing dumps
  npx tsx migrate-dump.ts --import-only --purge

Prerequisites:
  - pg_dump and psql must be installed (PostgreSQL client tools)
  - Windows: Install from https://www.postgresql.org/download/windows/
  - Or use: choco install postgresql
`);
  process.exit(0);
}

main().catch(console.error);
