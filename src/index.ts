import { MonadIndexer } from './indexer';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from './config';
import Database from 'better-sqlite3';

async function initializeDatabase(): Promise<void> {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');

  // Check if database exists
  const dbExists = fs.existsSync(CONFIG.DB_PATH);

  if (!dbExists) {
    console.log('📦 Initializing database...');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const db = new Database(CONFIG.DB_PATH);
    db.exec(schema);
    db.close();
    console.log('✅ Database initialized');
  } else {
    console.log('✅ Database already exists');
  }
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🚀 MONAD BLOCKCHAIN INDEXER 🚀                    ║
║                                                           ║
║  High-Performance EVM Indexer for Monad                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  try {
    // Initialize database
    await initializeDatabase();

    // Create and start indexer
    const indexer = new MonadIndexer();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⚠️  Received SIGINT, shutting down gracefully...');
      await indexer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n\n⚠️  Received SIGTERM, shutting down gracefully...');
      await indexer.stop();
      process.exit(0);
    });

    // Start indexing
    await indexer.start();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
