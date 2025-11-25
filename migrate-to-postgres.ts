import Database from 'better-sqlite3';
import { Pool, PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

// PostgreSQL Connection Config
const pgConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || '',
  password: process.env.PG_PASSWORD || '',
  ssl: { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' },
  max: parseInt(process.env.PG_MAX_CONNECTIONS || '2'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Migration configuration for speed
const BATCH_SIZE = 50000; // Rows per batch
const PROGRESS_FILE = 'migration_progress.json';

interface MigrationProgress {
  completedTables: string[];
  currentTable?: string;
  currentOffset?: number;
  lastOrderValue?: any;
  startTime: number;
  lastUpdate: number;
}

interface TableConfig {
  name: string;
  columns: string[];
  hasAutoIncrement: boolean;
  orderBy?: string;
}

// Table migration order (respecting foreign keys - migrate parents first)
const TABLES: TableConfig[] = [
  {
    name: 'blocks',
    columns: ['number', 'hash', 'parent_hash', 'nonce', 'sha3_uncles', 'logs_bloom', 'transactions_root', 'state_root', 'receipts_root', 'miner', 'difficulty', 'total_difficulty', 'extra_data', 'size', 'gas_limit', 'gas_used', 'timestamp', 'base_fee_per_gas', 'transaction_count', 'indexed_at'],
    hasAutoIncrement: false,
    orderBy: 'number'
  },
  {
    name: 'transactions',
    columns: ['hash', 'block_number', 'block_hash', 'transaction_index', 'from_address', 'to_address', 'value', 'gas', 'gas_price', 'max_fee_per_gas', 'max_priority_fee_per_gas', 'input', 'nonce', 'type', 'chain_id', 'v', 'r', 's', 'access_list', 'status', 'gas_used', 'cumulative_gas_used', 'effective_gas_price', 'contract_address', 'logs_count', 'indexed_at'],
    hasAutoIncrement: false,
    orderBy: 'block_number'
  },
  {
    name: 'logs',
    columns: ['id', 'transaction_hash', 'block_number', 'block_hash', 'address', 'log_index', 'data', 'topic0', 'topic1', 'topic2', 'topic3', 'removed', 'event_name', 'event_signature', 'event_standard', 'decoded_params', 'indexed_at'],
    hasAutoIncrement: true,
    orderBy: 'id'
  },
  {
    name: 'contracts',
    columns: ['address', 'creator_address', 'creation_tx_hash', 'creation_block_number', 'bytecode', 'is_erc20', 'is_erc721', 'is_erc1155', 'abi', 'verified', 'indexed_at'],
    hasAutoIncrement: false
  },
  {
    name: 'erc20_tokens',
    columns: ['address', 'name', 'symbol', 'decimals', 'total_supply', 'indexed_at'],
    hasAutoIncrement: false
  },
  {
    name: 'erc721_tokens',
    columns: ['address', 'name', 'symbol', 'total_supply', 'indexed_at'],
    hasAutoIncrement: false
  },
  {
    name: 'erc1155_tokens',
    columns: ['address', 'uri', 'indexed_at'],
    hasAutoIncrement: false
  },
  {
    name: 'addresses',
    columns: ['address', 'first_seen_block', 'first_seen_tx', 'is_contract', 'tx_count', 'balance', 'last_updated_block', 'indexed_at'],
    hasAutoIncrement: false
  },
  {
    name: 'address_transactions',
    columns: ['address', 'transaction_hash', 'block_number', 'is_from', 'is_to'],
    hasAutoIncrement: false,
    orderBy: 'block_number'
  },
  {
    name: 'erc20_transfers',
    columns: ['id', 'transaction_hash', 'log_index', 'block_number', 'token_address', 'from_address', 'to_address', 'value', 'indexed_at'],
    hasAutoIncrement: true,
    orderBy: 'id'
  },
  {
    name: 'erc721_transfers',
    columns: ['id', 'transaction_hash', 'log_index', 'block_number', 'token_address', 'from_address', 'to_address', 'token_id', 'indexed_at'],
    hasAutoIncrement: true,
    orderBy: 'id'
  },
  {
    name: 'indexer_state',
    columns: ['id', 'forward_block', 'backward_block', 'latest_block', 'is_synced', 'last_updated'],
    hasAutoIncrement: false
  }
];

class SQLiteToPostgresMigrator {
  private sqlite: Database.Database;
  private pgPool: Pool;
  private progress: MigrationProgress;

  constructor() {
    console.log('Initializing SQLite connection...');
    this.sqlite = new Database('monad.db', { readonly: true });
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('cache_size = -256000'); // 256MB cache for reading

    console.log('Initializing PostgreSQL connection pool...');
    this.pgPool = new Pool(pgConfig);

    this.progress = this.loadProgress();
  }

  private loadProgress(): MigrationProgress {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log('Resuming from previous migration...');
      return data;
    }
    return {
      completedTables: [],
      startTime: Date.now(),
      lastUpdate: Date.now()
    };
  }

  private saveProgress(): void {
    this.progress.lastUpdate = Date.now();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(this.progress, null, 2));
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  async createSchema(): Promise<void> {
    console.log('\n=== Creating PostgreSQL Schema ===');
    const schemaSQL = fs.readFileSync('schema-postgres.sql', 'utf8');
    const client = await this.pgPool.connect();
    try {
      await client.query(schemaSQL);
      console.log('Schema created successfully');
    } finally {
      client.release();
    }
  }

  async getTableCount(tableName: string): Promise<number> {
    const result = this.sqlite.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
    return result.count;
  }

  async getDistinctTableCount(tableName: string, primaryKey: string): Promise<number> {
    const result = this.sqlite.prepare(`SELECT COUNT(DISTINCT ${primaryKey}) as count FROM ${tableName}`).get() as { count: number };
    return result.count;
  }

  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return '\\N';
    }
    if (typeof value === 'string') {
      // Escape special characters for COPY format
      return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    }
    return String(value);
  }

  async migrateTable(tableConfig: TableConfig): Promise<void> {
    const { name, columns, hasAutoIncrement, orderBy } = tableConfig;

    if (this.progress.completedTables.includes(name)) {
      console.log(`Skipping ${name} (already completed)`);
      return;
    }

    const totalRows = await this.getTableCount(name);
    if (totalRows === 0) {
      console.log(`Table ${name} is empty, skipping...`);
      this.progress.completedTables.push(name);
      this.saveProgress();
      return;
    }

    console.log(`\n--- Migrating ${name}: ${totalRows.toLocaleString()} rows ---`);

    const client = await this.pgPool.connect();
    let offset = this.progress.currentTable === name ? (this.progress.currentOffset || 0) : 0;
    let migratedRows = offset;
    const startTime = Date.now();
    let lastOrderValue: any = this.progress.currentTable === name ? this.progress.lastOrderValue : null;

    try {
      // Disable triggers and constraints for speed
      await client.query('SET session_replication_role = replica;');

      // Clear table before inserting (handles resume after partial migration)
      if (offset === 0) {
        console.log(`  Clearing existing data from ${name}...`);
        await client.query(`TRUNCATE TABLE ${name} CASCADE`);
      }

      while (offset < totalRows) {
        const batchStart = Date.now();

        // Fetch batch from SQLite using WHERE for pagination to handle duplicates
        let query: string;
        let rows: any[];

        if (orderBy && !hasAutoIncrement) {
          // Use cursor-based pagination for tables with orderBy to avoid duplicates
          if (lastOrderValue !== null) {
            query = `SELECT ${columns.join(', ')} FROM ${name} WHERE ${orderBy} > ? GROUP BY ${orderBy} ORDER BY ${orderBy} LIMIT ${BATCH_SIZE}`;
            rows = this.sqlite.prepare(query).all(lastOrderValue);
          } else {
            query = `SELECT ${columns.join(', ')} FROM ${name} GROUP BY ${orderBy} ORDER BY ${orderBy} LIMIT ${BATCH_SIZE}`;
            rows = this.sqlite.prepare(query).all();
          }
        } else {
          // For auto-increment tables or no orderBy, use regular OFFSET
          const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
          query = `SELECT ${columns.join(', ')} FROM ${name} ${orderClause} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
          rows = this.sqlite.prepare(query).all();
        }

        if (rows.length === 0) break;

        // Use COPY for fast insertion
        const copyQuery = `COPY ${name} (${columns.join(', ')}) FROM STDIN WITH (FORMAT text, NULL '\\N')`;
        const copyStream = client.query(copyFrom(copyQuery));

        // Create readable stream from rows
        let rowIndex = 0;
        const dataStream = new Readable({
          read() {
            // Push rows in chunks to avoid blocking
            const chunkSize = 1000;
            let pushed = 0;
            while (rowIndex < rows.length && pushed < chunkSize) {
              const row = rows[rowIndex];
              const values = columns.map(col => {
                const value = (row as any)[col];
                if (value === null || value === undefined) return '\\N';
                if (typeof value === 'string') {
                  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                }
                return String(value);
              });
              this.push(values.join('\t') + '\n');
              rowIndex++;
              pushed++;
            }
            if (rowIndex >= rows.length) {
              this.push(null);
            }
          }
        });

        await new Promise<void>((resolve, reject) => {
          dataStream.pipe(copyStream)
            .on('finish', resolve)
            .on('error', reject);
        });

        // Track the last orderBy value for cursor-based pagination
        if (orderBy && !hasAutoIncrement && rows.length > 0) {
          lastOrderValue = (rows[rows.length - 1] as any)[orderBy];
        }

        offset += rows.length;
        migratedRows = offset;

        // Update progress
        this.progress.currentTable = name;
        this.progress.currentOffset = offset;
        this.progress.lastOrderValue = lastOrderValue;
        this.saveProgress();

        // Calculate stats
        const batchTime = Date.now() - batchStart;
        const rowsPerSecond = Math.round(rows.length / (batchTime / 1000));
        const percentComplete = ((offset / totalRows) * 100).toFixed(2);
        const elapsed = Date.now() - startTime;
        const estimatedTotal = (elapsed / offset) * totalRows;
        const remaining = estimatedTotal - elapsed;

        console.log(
          `  Progress: ${offset.toLocaleString()}/${totalRows.toLocaleString()} (${percentComplete}%) | ` +
          `Speed: ${rowsPerSecond.toLocaleString()} rows/s | ` +
          `ETA: ${this.formatDuration(remaining)}`
        );
      }

      // Reset sequence for auto-increment tables
      if (hasAutoIncrement) {
        const maxIdResult = this.sqlite.prepare(`SELECT MAX(id) as max_id FROM ${name}`).get() as { max_id: number };
        if (maxIdResult.max_id) {
          await client.query(`SELECT setval('${name}_id_seq', $1, true)`, [maxIdResult.max_id]);
          console.log(`  Reset sequence for ${name} to ${maxIdResult.max_id}`);
        }
      }

      // Re-enable triggers
      await client.query('SET session_replication_role = DEFAULT;');

      this.progress.completedTables.push(name);
      this.progress.currentTable = undefined;
      this.progress.currentOffset = undefined;
      this.progress.lastOrderValue = undefined;
      this.saveProgress();

      const totalTime = Date.now() - startTime;
      console.log(`  Completed ${name} in ${this.formatDuration(totalTime)}`);

    } catch (error) {
      console.error(`Error migrating ${name}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createIndexes(): Promise<void> {
    console.log('\n=== Creating Indexes (this may take a while) ===');

    const indexQueries = [
      // Blocks indexes
      'CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_blocks_miner ON blocks(miner)',
      'CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash)',

      // Transactions indexes
      'CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number)',
      'CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_address)',
      'CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address)',
      'CREATE INDEX IF NOT EXISTS idx_tx_contract ON transactions(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status)',
      'CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type)',

      // Logs indexes
      'CREATE INDEX IF NOT EXISTS idx_logs_tx ON logs(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_logs_block ON logs(block_number)',
      'CREATE INDEX IF NOT EXISTS idx_logs_address ON logs(address)',
      'CREATE INDEX IF NOT EXISTS idx_logs_topic0 ON logs(topic0)',
      'CREATE INDEX IF NOT EXISTS idx_logs_topic1 ON logs(topic1)',
      'CREATE INDEX IF NOT EXISTS idx_logs_topic2 ON logs(topic2)',
      'CREATE INDEX IF NOT EXISTS idx_logs_topic3 ON logs(topic3)',
      'CREATE INDEX IF NOT EXISTS idx_logs_event_name ON logs(event_name)',
      'CREATE INDEX IF NOT EXISTS idx_logs_event_standard ON logs(event_standard)',

      // Contracts indexes
      'CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_address)',
      'CREATE INDEX IF NOT EXISTS idx_contracts_block ON contracts(creation_block_number)',
      'CREATE INDEX IF NOT EXISTS idx_contracts_erc20 ON contracts(is_erc20)',
      'CREATE INDEX IF NOT EXISTS idx_contracts_erc721 ON contracts(is_erc721)',
      'CREATE INDEX IF NOT EXISTS idx_contracts_erc1155 ON contracts(is_erc1155)',

      // Token indexes
      'CREATE INDEX IF NOT EXISTS idx_erc20_symbol ON erc20_tokens(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_erc20_name ON erc20_tokens(name)',

      // Address indexes
      'CREATE INDEX IF NOT EXISTS idx_addresses_first_block ON addresses(first_seen_block)',
      'CREATE INDEX IF NOT EXISTS idx_addresses_is_contract ON addresses(is_contract)',

      // Address transactions indexes
      'CREATE INDEX IF NOT EXISTS idx_addr_tx_block ON address_transactions(block_number)',
      'CREATE INDEX IF NOT EXISTS idx_addr_tx_address ON address_transactions(address)',

      // ERC20 transfers indexes
      'CREATE INDEX IF NOT EXISTS idx_erc20_tx ON erc20_transfers(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_erc20_token ON erc20_transfers(token_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc20_from ON erc20_transfers(from_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc20_to ON erc20_transfers(to_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc20_block ON erc20_transfers(block_number)',

      // ERC721 transfers indexes
      'CREATE INDEX IF NOT EXISTS idx_erc721_tx ON erc721_transfers(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_erc721_token ON erc721_transfers(token_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc721_from ON erc721_transfers(from_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc721_to ON erc721_transfers(to_address)',
      'CREATE INDEX IF NOT EXISTS idx_erc721_block ON erc721_transfers(block_number)',
    ];

    const client = await this.pgPool.connect();
    try {
      for (let i = 0; i < indexQueries.length; i++) {
        const query = indexQueries[i];
        const indexName = query.match(/idx_\w+/)?.[0] || `index_${i}`;
        console.log(`  Creating ${indexName} (${i + 1}/${indexQueries.length})...`);
        const start = Date.now();
        await client.query(query);
        console.log(`    Done in ${this.formatDuration(Date.now() - start)}`);
      }
    } finally {
      client.release();
    }
  }

  async addForeignKeys(): Promise<void> {
    console.log('\n=== Adding Foreign Key Constraints ===');

    const fkQueries = [
      'ALTER TABLE transactions ADD CONSTRAINT fk_tx_block FOREIGN KEY (block_number) REFERENCES blocks(number)',
      'ALTER TABLE logs ADD CONSTRAINT fk_logs_tx FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)',
      'ALTER TABLE logs ADD CONSTRAINT fk_logs_block FOREIGN KEY (block_number) REFERENCES blocks(number)',
      'ALTER TABLE contracts ADD CONSTRAINT fk_contracts_tx FOREIGN KEY (creation_tx_hash) REFERENCES transactions(hash)',
      'ALTER TABLE contracts ADD CONSTRAINT fk_contracts_block FOREIGN KEY (creation_block_number) REFERENCES blocks(number)',
      'ALTER TABLE erc20_tokens ADD CONSTRAINT fk_erc20_contract FOREIGN KEY (address) REFERENCES contracts(address)',
      'ALTER TABLE erc721_tokens ADD CONSTRAINT fk_erc721_contract FOREIGN KEY (address) REFERENCES contracts(address)',
      'ALTER TABLE erc1155_tokens ADD CONSTRAINT fk_erc1155_contract FOREIGN KEY (address) REFERENCES contracts(address)',
      'ALTER TABLE address_transactions ADD CONSTRAINT fk_addr_tx_addr FOREIGN KEY (address) REFERENCES addresses(address)',
      'ALTER TABLE address_transactions ADD CONSTRAINT fk_addr_tx_hash FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)',
      'ALTER TABLE erc20_transfers ADD CONSTRAINT fk_erc20_transfers_tx FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)',
      'ALTER TABLE erc721_transfers ADD CONSTRAINT fk_erc721_transfers_tx FOREIGN KEY (transaction_hash) REFERENCES transactions(hash)',
    ];

    const client = await this.pgPool.connect();
    try {
      for (const query of fkQueries) {
        try {
          await client.query(query);
          const fkName = query.match(/fk_\w+/)?.[0] || 'constraint';
          console.log(`  Added ${fkName}`);
        } catch (error: any) {
          // Skip if constraint already exists or there's a data issue
          if (error.code === '23503') {
            console.log(`  Skipping ${query.match(/fk_\w+/)?.[0]} (data integrity issue)`);
          } else if (error.code === '42710') {
            console.log(`  ${query.match(/fk_\w+/)?.[0]} already exists`);
          } else {
            console.error(`  Warning: ${error.message}`);
          }
        }
      }
    } finally {
      client.release();
    }
  }

  async run(): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     SQLite to PostgreSQL Migration Tool (PlanetScale)     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    const dbStats = fs.statSync('monad.db');
    console.log(`\nSource database: monad.db (${this.formatBytes(dbStats.size)})`);
    console.log(`Target: PlanetScale PostgreSQL (${pgConfig.host})`);
    console.log(`Batch size: ${BATCH_SIZE.toLocaleString()} rows`);

    try {
      // Test connection
      console.log('\nTesting PostgreSQL connection...');
      const client = await this.pgPool.connect();
      const versionResult = await client.query('SELECT version()');
      console.log(`Connected to: ${versionResult.rows[0].version.split(',')[0]}`);
      client.release();

      // Create schema
      await this.createSchema();

      // Migrate tables
      console.log('\n=== Migrating Data ===');
      const migrationStart = Date.now();

      for (const table of TABLES) {
        await this.migrateTable(table);
      }

      // Create indexes after data load (much faster)
      await this.createIndexes();

      // Add foreign keys (optional, can be slow)
      // await this.addForeignKeys();

      const totalTime = Date.now() - migrationStart;
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║                   Migration Complete!                      ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
      console.log(`Total time: ${this.formatDuration(totalTime)}`);
      console.log(`Tables migrated: ${this.progress.completedTables.length}`);

      // Cleanup progress file
      if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
        console.log('Progress file cleaned up.');
      }

    } catch (error) {
      console.error('\nMigration failed:', error);
      console.log('Progress has been saved. You can resume by running the script again.');
      throw error;
    } finally {
      this.sqlite.close();
      await this.pgPool.end();
    }
  }
}

// Run migration
const migrator = new SQLiteToPostgresMigrator();
migrator.run().catch(console.error);
