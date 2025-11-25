/**
 * ABI Signature Scanner
 * Scans ABI JSON files and populates the database with function/event signatures
 *
 * Usage:
 *   tsx src/scan-abi-signatures.ts <folder-path>
 *   tsx src/scan-abi-signatures.ts <single-file.json>
 *
 * Features:
 * - Processes both functions and events
 * - Skips already-filled signatures
 * - Handles Hardhat artifacts and raw ABI arrays
 * - Batch inserts for performance
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import { Interface, id as keccak256 } from 'ethers';
import { Pool } from 'pg';
import { CONFIG } from './config';

interface FunctionSignature {
  selector: string;
  name: string;
  signature: string;
  type: 'function' | 'event';
  inputs: any[];
  outputs: any[];
  stateMutability: string | null;
  sourceContract: string;
  sourceFile: string;
}

interface AbiItem {
  type: string;
  name?: string;
  inputs?: any[];
  outputs?: any[];
  stateMutability?: string;
  anonymous?: boolean;
}

interface HardhatArtifact {
  _format?: string;
  contractName?: string;
  sourceName?: string;
  abi?: AbiItem[];
}

class AbiSignatureScanner {
  private pool: Pool;
  private existingSelectors: Set<string> = new Set();
  private newSignatures: FunctionSignature[] = [];
  private stats = {
    filesProcessed: 0,
    functionsFound: 0,
    eventsFound: 0,
    skipped: 0,
    inserted: 0,
    errors: 0,
  };

  constructor() {
    this.pool = new Pool({
      host: CONFIG.PG_HOST,
      port: CONFIG.PG_PORT,
      database: CONFIG.PG_DATABASE,
      user: CONFIG.PG_USER,
      password: CONFIG.PG_PASSWORD,
      ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }

  async initialize(): Promise<void> {
    // Create table if not exists
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS function_signatures (
        selector TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        signature TEXT NOT NULL,
        type TEXT NOT NULL,
        inputs TEXT,
        outputs TEXT,
        state_mutability TEXT,
        source_contract TEXT,
        source_file TEXT,
        indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_function_signatures_name ON function_signatures(name)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_function_signatures_type ON function_signatures(type)
    `);

    // Load existing selectors
    const result = await this.pool.query('SELECT selector FROM function_signatures');
    for (const row of result.rows) {
      this.existingSelectors.add(row.selector);
    }

    console.log(`\nLoaded ${this.existingSelectors.size} existing signatures from database\n`);
  }

  computeFunctionSelector(name: string, inputs: any[]): string {
    const types = inputs.map(input => this.getCanonicalType(input)).join(',');
    const signature = `${name}(${types})`;
    const hash = keccak256(signature);
    return hash.slice(0, 10); // First 4 bytes = 8 hex chars + 0x prefix
  }

  computeEventTopic(name: string, inputs: any[]): string {
    const types = inputs.map(input => this.getCanonicalType(input)).join(',');
    const signature = `${name}(${types})`;
    return keccak256(signature);
  }

  getCanonicalType(input: any): string {
    if (input.type === 'tuple') {
      const componentTypes = input.components.map((c: any) => this.getCanonicalType(c)).join(',');
      return `(${componentTypes})`;
    }
    if (input.type === 'tuple[]') {
      const componentTypes = input.components.map((c: any) => this.getCanonicalType(c)).join(',');
      return `(${componentTypes})[]`;
    }
    return input.type;
  }

  buildSignatureString(name: string, inputs: any[]): string {
    const types = inputs.map(input => this.getCanonicalType(input)).join(',');
    return `${name}(${types})`;
  }

  extractSignaturesFromAbi(abiItems: AbiItem[], contractName: string, sourceFile: string): void {
    for (const item of abiItems) {
      try {
        if (item.type === 'function' && item.name) {
          const selector = this.computeFunctionSelector(item.name, item.inputs || []);

          if (this.existingSelectors.has(selector)) {
            this.stats.skipped++;
            continue;
          }

          const signature = this.buildSignatureString(item.name, item.inputs || []);

          this.newSignatures.push({
            selector,
            name: item.name,
            signature,
            type: 'function',
            inputs: item.inputs || [],
            outputs: item.outputs || [],
            stateMutability: item.stateMutability || null,
            sourceContract: contractName,
            sourceFile,
          });

          this.existingSelectors.add(selector);
          this.stats.functionsFound++;

        } else if (item.type === 'event' && item.name) {
          const topicHash = this.computeEventTopic(item.name, item.inputs || []);

          if (this.existingSelectors.has(topicHash)) {
            this.stats.skipped++;
            continue;
          }

          const signature = this.buildSignatureString(item.name, item.inputs || []);

          this.newSignatures.push({
            selector: topicHash,
            name: item.name,
            signature,
            type: 'event',
            inputs: item.inputs || [],
            outputs: [],
            stateMutability: null,
            sourceContract: contractName,
            sourceFile,
          });

          this.existingSelectors.add(topicHash);
          this.stats.eventsFound++;
        }
      } catch (error) {
        console.error(`  Error processing ${item.type} ${item.name}:`, error);
        this.stats.errors++;
      }
    }
  }

  processAbiFile(filePath: string): void {
    try {
      const content = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);

      let abiArray: AbiItem[];
      let contractName: string;

      // Handle Hardhat artifacts vs raw ABI arrays
      if (Array.isArray(parsed)) {
        abiArray = parsed;
        contractName = basename(filePath, '.json');
      } else if (parsed.abi && Array.isArray(parsed.abi)) {
        abiArray = parsed.abi;
        contractName = parsed.contractName || basename(filePath, '.json');
      } else {
        console.log(`  Skipping ${filePath} - not a valid ABI format`);
        return;
      }

      console.log(`Processing: ${basename(filePath)} (${contractName})`);
      this.extractSignaturesFromAbi(abiArray, contractName, filePath);
      this.stats.filesProcessed++;

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(`  File not found: ${filePath}`);
      } else if (error instanceof SyntaxError) {
        console.log(`  Skipping ${filePath} - invalid JSON`);
      } else {
        console.error(`  Error processing ${filePath}:`, error);
      }
      this.stats.errors++;
    }
  }

  scanDirectory(dirPath: string): void {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry !== 'node_modules' && !entry.startsWith('.')) {
          this.scanDirectory(fullPath);
        }
      } else if (entry.endsWith('.json')) {
        this.processAbiFile(fullPath);
      }
    }
  }

  async saveToDatabase(): Promise<void> {
    if (this.newSignatures.length === 0) {
      console.log('\nNo new signatures to save.');
      return;
    }

    console.log(`\nSaving ${this.newSignatures.length} new signatures to database...`);

    const batchSize = 100;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (let i = 0; i < this.newSignatures.length; i += batchSize) {
        const batch = this.newSignatures.slice(i, i + batchSize);

        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const sig of batch) {
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            sig.selector,
            sig.name,
            sig.signature,
            sig.type,
            JSON.stringify(sig.inputs),
            JSON.stringify(sig.outputs),
            sig.stateMutability,
            sig.sourceContract,
            sig.sourceFile
          );
        }

        const query = `
          INSERT INTO function_signatures (
            selector, name, signature, type, inputs, outputs,
            state_mutability, source_contract, source_file
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (selector) DO NOTHING
        `;

        await client.query(query, values);
        this.stats.inserted += batch.length;

        process.stdout.write(`\r  Inserted: ${this.stats.inserted}/${this.newSignatures.length}`);
      }

      await client.query('COMMIT');
      console.log('\n  Database save completed.');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('\n  Database error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  printStats(): void {
    console.log('\n=== Scan Results ===');
    console.log(`Files processed: ${this.stats.filesProcessed}`);
    console.log(`Functions found: ${this.stats.functionsFound}`);
    console.log(`Events found: ${this.stats.eventsFound}`);
    console.log(`Skipped (already exists): ${this.stats.skipped}`);
    console.log(`Inserted to database: ${this.stats.inserted}`);
    console.log(`Errors: ${this.stats.errors}`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async run(targetPath: string): Promise<void> {
    console.log('=== ABI Signature Scanner ===');
    console.log(`Target: ${targetPath}\n`);

    await this.initialize();

    const resolvedPath = resolve(targetPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    const stat = statSync(resolvedPath);

    if (stat.isDirectory()) {
      console.log('Scanning directory for ABI files...\n');
      this.scanDirectory(resolvedPath);
    } else if (stat.isFile()) {
      this.processAbiFile(resolvedPath);
    } else {
      throw new Error('Path is neither a file nor a directory');
    }

    await this.saveToDatabase();
    this.printStats();
  }
}

// CLI interface
async function main() {
  const targetPath = process.argv[2];

  if (!targetPath) {
    console.error('Usage: tsx src/scan-abi-signatures.ts <folder-path|file-path>');
    console.error('\nExamples:');
    console.error('  tsx src/scan-abi-signatures.ts ./artifacts');
    console.error('  tsx src/scan-abi-signatures.ts ./contracts/MyContract.json');
    process.exit(1);
  }

  const scanner = new AbiSignatureScanner();

  try {
    await scanner.run(targetPath);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await scanner.close();
  }
}

main();

export { AbiSignatureScanner };
