import { CONFIG } from './config';
import { DatabaseManager } from './database';
import { PostgresDatabaseManager } from './database-pg';
import type {
  Block,
  Transaction,
  TransactionReceipt,
  Log,
  Contract,
  ERC20Token,
  ERC721Token,
  ERC1155Token,
  Address,
  IndexerState,
} from './types';

// Unified async interface for both database types
export interface IDatabaseManager {
  insertBlock(block: Block): Promise<void>;
  insertTransaction(tx: Transaction, receipt: TransactionReceipt): Promise<void>;
  insertLog(log: Log, decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any }): Promise<void>;
  insertContract(contract: Contract, abi?: string): Promise<void>;
  insertERC20Token(token: ERC20Token): Promise<void>;
  insertERC721Token(token: ERC721Token): Promise<void>;
  insertERC1155Token(token: ERC1155Token): Promise<void>;
  insertAddress(address: Address): Promise<void>;
  insertAddressTransaction(address: string, txHash: string, blockNumber: number, isFrom: boolean, isTo: boolean): Promise<void>;
  insertERC20Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, value: string): Promise<void>;
  insertERC721Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, tokenId: string): Promise<void>;
  updateIndexerState(state: Partial<IndexerState>): Promise<void>;
  getIndexerState(): Promise<IndexerState>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
  getStats(): Promise<{
    blocks: number;
    transactions: number;
    contracts: number;
    erc20Tokens: number;
    erc721Tokens: number;
  }>;
  // Bulk insert methods (optional, for performance)
  bulkInsertLogs?(logs: Array<{ log: Log; decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any } }>): Promise<void>;
  bulkInsertAddresses?(addresses: Address[]): Promise<void>;
  bulkInsertAddressTransactions?(txs: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }>): Promise<void>;
}

// Wrapper for SQLite to provide async interface
class SQLiteAsyncWrapper implements IDatabaseManager {
  private db: DatabaseManager;

  constructor(dbPath: string) {
    this.db = new DatabaseManager(dbPath);
  }

  async insertBlock(block: Block): Promise<void> {
    this.db.insertBlock(block);
  }

  async insertTransaction(tx: Transaction, receipt: TransactionReceipt): Promise<void> {
    this.db.insertTransaction(tx, receipt);
  }

  async insertLog(log: Log, decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any }): Promise<void> {
    this.db.insertLog(log, decodedEvent);
  }

  async insertContract(contract: Contract, abi?: string): Promise<void> {
    this.db.insertContract(contract, abi);
  }

  async insertERC20Token(token: ERC20Token): Promise<void> {
    this.db.insertERC20Token(token);
  }

  async insertERC721Token(token: ERC721Token): Promise<void> {
    this.db.insertERC721Token(token);
  }

  async insertERC1155Token(token: ERC1155Token): Promise<void> {
    this.db.insertERC1155Token(token);
  }

  async insertAddress(address: Address): Promise<void> {
    this.db.insertAddress(address);
  }

  async insertAddressTransaction(address: string, txHash: string, blockNumber: number, isFrom: boolean, isTo: boolean): Promise<void> {
    this.db.insertAddressTransaction(address, txHash, blockNumber, isFrom, isTo);
  }

  async insertERC20Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, value: string): Promise<void> {
    this.db.insertERC20Transfer(txHash, logIndex, blockNumber, tokenAddress, from, to, value);
  }

  async insertERC721Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, tokenId: string): Promise<void> {
    this.db.insertERC721Transfer(txHash, logIndex, blockNumber, tokenAddress, from, to, tokenId);
  }

  async updateIndexerState(state: Partial<IndexerState>): Promise<void> {
    this.db.updateIndexerState(state);
  }

  async getIndexerState(): Promise<IndexerState> {
    return this.db.getIndexerState();
  }

  async beginTransaction(): Promise<void> {
    this.db.beginTransaction();
  }

  async commit(): Promise<void> {
    this.db.commit();
  }

  async rollback(): Promise<void> {
    this.db.rollback();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async getStats(): Promise<{
    blocks: number;
    transactions: number;
    contracts: number;
    erc20Tokens: number;
    erc721Tokens: number;
  }> {
    return this.db.getStats();
  }
}

// Factory function to create the appropriate database manager
export function createDatabaseManager(silent: boolean = false): IDatabaseManager {
  if (CONFIG.DB_TYPE === 'postgres') {
    if (!silent) console.log('Using PostgreSQL database');
    return new PostgresDatabaseManager({
      host: CONFIG.PG_HOST,
      port: CONFIG.PG_PORT,
      database: CONFIG.PG_DATABASE,
      user: CONFIG.PG_USER,
      password: CONFIG.PG_PASSWORD,
      ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : undefined,
      max: CONFIG.PG_MAX_CONNECTIONS,
    });
  } else {
    if (!silent) console.log('Using SQLite database');
    return new SQLiteAsyncWrapper(CONFIG.DB_PATH);
  }
}
