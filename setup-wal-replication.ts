#!/usr/bin/env tsx
/**
 * WAL Logical Replication Setup Helper
 * Automates the setup of logical replication for large table migration
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
};

const REPLICATION_USER = 'replication_user';
const REPLICATION_PASSWORD = process.env.REPLICATION_PASSWORD || 'change_me_secure_password';
const PUBLICATION_NAME = 'logs_migration';
const SUBSCRIPTION_NAME = 'logs_subscription';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function checkSourceConfiguration(pool: Pool): Promise<boolean> {
  console.log('\n🔍 Checking source PostgreSQL configuration...\n');

  const client = await pool.connect();
  let allGood = true;

  try {
    // Check wal_level
    const walLevel = await client.query("SHOW wal_level");
    const level = walLevel.rows[0].wal_level;
    if (level === 'logical') {
      console.log(`✅ wal_level = ${level}`);
    } else {
      console.log(`❌ wal_level = ${level} (needs to be 'logical')`);
      console.log('   Edit postgresql.conf and set: wal_level = logical');
      console.log('   Then restart PostgreSQL service');
      allGood = false;
    }

    // Check max_replication_slots
    const maxSlots = await client.query("SHOW max_replication_slots");
    const slots = parseInt(maxSlots.rows[0].max_replication_slots);
    if (slots >= 4) {
      console.log(`✅ max_replication_slots = ${slots}`);
    } else {
      console.log(`❌ max_replication_slots = ${slots} (needs to be at least 4)`);
      allGood = false;
    }

    // Check max_wal_senders
    const maxSenders = await client.query("SHOW max_wal_senders");
    const senders = parseInt(maxSenders.rows[0].max_wal_senders);
    if (senders >= 4) {
      console.log(`✅ max_wal_senders = ${senders}`);
    } else {
      console.log(`❌ max_wal_senders = ${senders} (needs to be at least 4)`);
      allGood = false;
    }

    // Check logs table row count
    const logsCount = await client.query("SELECT COUNT(*) as count FROM logs");
    console.log(`\n📊 logs table has ${parseInt(logsCount.rows[0].count).toLocaleString()} rows`);

    // Check if publication exists
    const pubExists = await client.query(
      "SELECT * FROM pg_publication WHERE pubname = $1",
      [PUBLICATION_NAME]
    );
    if (pubExists.rows.length > 0) {
      console.log(`\n✅ Publication '${PUBLICATION_NAME}' already exists`);
    } else {
      console.log(`\nℹ️  Publication '${PUBLICATION_NAME}' does not exist (will be created)`);
    }

  } finally {
    client.release();
  }

  return allGood;
}

async function setupSourceReplication(pool: Pool): Promise<void> {
  console.log('\n🔧 Setting up replication on source database...\n');

  const client = await pool.connect();

  try {
    // Create replication user
    console.log(`Creating replication user '${REPLICATION_USER}'...`);
    try {
      await client.query(`
        CREATE USER ${REPLICATION_USER}
        WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}'
      `);
      console.log(`  ✅ User created`);
    } catch (e: any) {
      if (e.code === '42710') {
        console.log(`  ℹ️  User already exists`);
        // Update password
        await client.query(`ALTER USER ${REPLICATION_USER} PASSWORD '${REPLICATION_PASSWORD}'`);
        console.log(`  ✅ Password updated`);
      } else {
        throw e;
      }
    }

    // Grant permissions
    console.log(`Granting permissions...`);
    await client.query(`GRANT CONNECT ON DATABASE ${SOURCE_CONFIG.database} TO ${REPLICATION_USER}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${REPLICATION_USER}`);
    await client.query(`GRANT SELECT ON logs TO ${REPLICATION_USER}`);
    console.log(`  ✅ Permissions granted`);

    // Create publication
    console.log(`Creating publication '${PUBLICATION_NAME}'...`);
    try {
      await client.query(`CREATE PUBLICATION ${PUBLICATION_NAME} FOR TABLE logs`);
      console.log(`  ✅ Publication created`);
    } catch (e: any) {
      if (e.code === '42710') {
        console.log(`  ℹ️  Publication already exists`);
      } else {
        throw e;
      }
    }

    // Verify
    const tables = await client.query(`
      SELECT tablename FROM pg_publication_tables WHERE pubname = $1
    `, [PUBLICATION_NAME]);
    console.log(`  📋 Publishing tables: ${tables.rows.map(r => r.tablename).join(', ')}`);

  } finally {
    client.release();
  }
}

async function createSubscription(pool: Pool, sourcePublicHost: string): Promise<void> {
  console.log('\n🔗 Creating subscription on PlanetScale...\n');

  const client = await pool.connect();

  try {
    // First check if subscription exists
    const subExists = await client.query(
      "SELECT * FROM pg_subscription WHERE subname = $1",
      [SUBSCRIPTION_NAME]
    );

    if (subExists.rows.length > 0) {
      console.log(`⚠️  Subscription '${SUBSCRIPTION_NAME}' already exists`);
      const answer = await prompt('Do you want to drop and recreate it? (y/n): ');
      if (answer.toLowerCase() === 'y') {
        await client.query(`DROP SUBSCRIPTION ${SUBSCRIPTION_NAME}`);
        console.log(`  ✅ Dropped existing subscription`);
      } else {
        console.log(`  ℹ️  Keeping existing subscription`);
        return;
      }
    }

    // Create connection string
    const connectionString = `host=${sourcePublicHost} port=${SOURCE_CONFIG.port} dbname=${SOURCE_CONFIG.database} user=${REPLICATION_USER} password=${REPLICATION_PASSWORD}`;

    console.log(`Creating subscription...`);
    console.log(`  Source: ${sourcePublicHost}:${SOURCE_CONFIG.port}`);

    // Note: copy_data=true means it will copy existing data first
    await client.query(`
      CREATE SUBSCRIPTION ${SUBSCRIPTION_NAME}
      CONNECTION '${connectionString}'
      PUBLICATION ${PUBLICATION_NAME}
      WITH (
        copy_data = true,
        create_slot = true,
        synchronous_commit = off
      )
    `);

    console.log(`  ✅ Subscription created`);
    console.log(`  ℹ️  Initial data copy is now in progress...`);

  } finally {
    client.release();
  }
}

async function monitorReplication(sourcePool: Pool, targetPool: Pool): Promise<void> {
  console.log('\n📊 Monitoring replication status...\n');

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    // Check source replication slot
    console.log('Source database:');
    const slots = await sourceClient.query(`
      SELECT
        slot_name,
        active,
        restart_lsn,
        confirmed_flush_lsn,
        wal_status
      FROM pg_replication_slots
      WHERE slot_name LIKE '%${SUBSCRIPTION_NAME}%'
    `);

    if (slots.rows.length > 0) {
      for (const slot of slots.rows) {
        console.log(`  Slot: ${slot.slot_name}`);
        console.log(`    Active: ${slot.active}`);
        console.log(`    WAL Status: ${slot.wal_status}`);
        console.log(`    Restart LSN: ${slot.restart_lsn}`);
        console.log(`    Confirmed Flush LSN: ${slot.confirmed_flush_lsn}`);
      }
    } else {
      console.log(`  ⚠️  No replication slot found`);
    }

    // Check target subscription status
    console.log('\nPlanetScale database:');
    const subStatus = await targetClient.query(`
      SELECT
        subname,
        subenabled,
        received_lsn,
        latest_end_lsn,
        latest_end_time,
        last_msg_send_time,
        last_msg_receipt_time
      FROM pg_stat_subscription
      WHERE subname = $1
    `, [SUBSCRIPTION_NAME]);

    if (subStatus.rows.length > 0) {
      const status = subStatus.rows[0];
      console.log(`  Subscription: ${status.subname}`);
      console.log(`    Enabled: ${status.subenabled}`);
      console.log(`    Received LSN: ${status.received_lsn || 'N/A'}`);
      console.log(`    Latest End Time: ${status.latest_end_time || 'N/A'}`);
      console.log(`    Last Message Received: ${status.last_msg_receipt_time || 'N/A'}`);
    } else {
      console.log(`  ⚠️  No subscription stats found`);
    }

    // Compare row counts
    console.log('\nRow count comparison:');
    const sourceCount = await sourceClient.query('SELECT COUNT(*) as count FROM logs');
    const targetCount = await targetClient.query('SELECT COUNT(*) as count FROM logs');
    const srcRows = parseInt(sourceCount.rows[0].count);
    const tgtRows = parseInt(targetCount.rows[0].count);
    const pct = srcRows > 0 ? Math.round((tgtRows / srcRows) * 100) : 0;

    console.log(`  Source logs: ${srcRows.toLocaleString()} rows`);
    console.log(`  Target logs: ${tgtRows.toLocaleString()} rows`);
    console.log(`  Sync progress: ${pct}% (${(srcRows - tgtRows).toLocaleString()} rows behind)`);

  } finally {
    sourceClient.release();
    targetClient.release();
  }
}

async function cleanup(sourcePool: Pool, targetPool: Pool): Promise<void> {
  console.log('\n🧹 Cleaning up replication setup...\n');

  // Drop subscription on target
  const targetClient = await targetPool.connect();
  try {
    console.log('Dropping subscription on PlanetScale...');
    await targetClient.query(`DROP SUBSCRIPTION IF EXISTS ${SUBSCRIPTION_NAME}`);
    console.log('  ✅ Subscription dropped');
  } catch (e: any) {
    console.log(`  ⚠️  ${e.message}`);
  } finally {
    targetClient.release();
  }

  // Drop publication on source
  const sourceClient = await sourcePool.connect();
  try {
    console.log('Dropping publication on source...');
    await sourceClient.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION_NAME}`);
    console.log('  ✅ Publication dropped');

    console.log('Dropping replication user...');
    await sourceClient.query(`DROP USER IF EXISTS ${REPLICATION_USER}`);
    console.log('  ✅ User dropped');
  } catch (e: any) {
    console.log(`  ⚠️  ${e.message}`);
  } finally {
    sourceClient.release();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         WAL Logical Replication Setup for logs            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  const sourcePool = new Pool(SOURCE_CONFIG);
  const targetPool = new Pool(TARGET_CONFIG);

  try {
    switch (command) {
      case 'check':
        await checkSourceConfiguration(sourcePool);
        break;

      case 'setup-source':
        await setupSourceReplication(sourcePool);
        console.log('\n⚠️  IMPORTANT: You must also configure pg_hba.conf to allow replication connections!');
        console.log('   Add this line to pg_hba.conf:');
        console.log(`   host replication ${REPLICATION_USER} 0.0.0.0/0 md5`);
        console.log('   Then restart PostgreSQL service');
        break;

      case 'create-subscription':
        const publicHost = args[1];
        if (!publicHost) {
          console.error('❌ Please provide your public IP or domain as argument');
          console.error('   Usage: npx tsx setup-wal-replication.ts create-subscription YOUR_PUBLIC_IP');
          process.exit(1);
        }
        await createSubscription(targetPool, publicHost);
        break;

      case 'monitor':
        await monitorReplication(sourcePool, targetPool);
        break;

      case 'cleanup':
        const answer = await prompt('This will stop replication and remove setup. Continue? (y/n): ');
        if (answer.toLowerCase() === 'y') {
          await cleanup(sourcePool, targetPool);
        }
        break;

      default:
        console.log(`
WAL Logical Replication Setup Tool

Commands:
  check                              Check source database configuration
  setup-source                       Set up replication user and publication
  create-subscription <PUBLIC_IP>    Create subscription on PlanetScale
  monitor                            Monitor replication status
  cleanup                            Remove replication setup

Usage:
  1. npx tsx setup-wal-replication.ts check
  2. npx tsx setup-wal-replication.ts setup-source
  3. Configure pg_hba.conf for replication access
  4. npx tsx setup-wal-replication.ts create-subscription your.public.ip
  5. npx tsx setup-wal-replication.ts monitor
  6. npx tsx setup-wal-replication.ts cleanup (after migration)

Environment variables (in .env):
  REPLICATION_PASSWORD - Password for replication user (default: change_me_secure_password)

Requirements:
  - Source PostgreSQL must be accessible from PlanetScale (public IP/port forwarding)
  - wal_level must be set to 'logical' in postgresql.conf
  - pg_hba.conf must allow replication connections
        `);
    }
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch(console.error);
