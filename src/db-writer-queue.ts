import { IDatabaseManager } from './database-factory';
import { batchInsertChunked } from './batch-sql';
import { CONFIG } from './config';
import type { Block, Transaction, TransactionReceipt, Log, Contract, Address, ERC20Token, ERC721Token, ERC1155Token } from './types';
import { Pool, PoolClient } from 'pg';

export interface BlockData {
  type: 'block' | 'full_block';
  block?: Block;
  data?: Block;
  transactions?: Transaction[];
  receipts?: TransactionReceipt[];
  logs?: Array<{ log: Log; decodedEvent?: any }>;
  addresses?: Address[];
  addressTxs?: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }>;
  contracts?: Contract[];
  erc20Transfers?: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; value: string }>;
  erc721Transfers?: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; tokenId: string }>;
  erc1155Transfers?: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; operator: string; from: string; to: string; tokenId: string; value: string }>;
  erc20Tokens?: ERC20Token[];
  erc721Tokens?: ERC721Token[];
  erc1155Tokens?: ERC1155Token[];
}

export class BackgroundDBWriter {
  private queue: BlockData[] = [];
  private isProcessing = false;
  private shouldStop = false;
  private processPromise: Promise<void> | null = null;
  private drainResolvers: Array<() => void> = [];
  private pgPool: Pool | null = null;

  constructor(private db: IDatabaseManager) {
    // Create direct PG pool for fast batch inserts
    if (CONFIG.DB_TYPE === 'postgres') {
      this.pgPool = new Pool({
        host: CONFIG.PG_HOST,
        port: CONFIG.PG_PORT,
        database: CONFIG.PG_DATABASE,
        user: CONFIG.PG_USER,
        password: CONFIG.PG_PASSWORD,
        ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
        max: 15, // Direct connections limit
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
    }
  }

  enqueue(data: BlockData): void {
    this.queue.push(data);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  start(): void {
    this.shouldStop = false;
    this.processPromise = this.processLoop();
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    // Clear queue to stop processing
    this.queue = [];
    // Resolve any drain waiters
    while (this.drainResolvers.length > 0) {
      const resolver = this.drainResolvers.shift();
      if (resolver) resolver();
    }
    if (this.processPromise) {
      await this.processPromise;
    }
    if (this.pgPool) {
      await this.pgPool.end();
    }
  }

  async waitForDrain(): Promise<void> {
    if (this.queue.length === 0) return;

    return new Promise<void>(resolve => {
      this.drainResolvers.push(resolve);
    });
  }

  private async processLoop(): Promise<void> {
    const PARALLEL_WRITERS = 15;  // Number of parallel DB write connections (match pool size)
    const BATCH_SIZE = 200;       // Blocks per batch (increased from 100)

    while (!this.shouldStop || this.queue.length > 0) {
      if (this.queue.length === 0) {
        // Notify drain waiters
        while (this.drainResolvers.length > 0) {
          const resolver = this.drainResolvers.shift();
          if (resolver) resolver();
        }

        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }

      // Process multiple batches in parallel
      const batchesToProcess: BlockData[][] = [];
      // Increase parallel writers for faster throughput during live mode
      const ACTIVE_WRITERS = this.queue.length > 1000 ? PARALLEL_WRITERS : Math.min(this.queue.length, PARALLEL_WRITERS);
      
      for (let i = 0; i < ACTIVE_WRITERS && this.queue.length > 0; i++) {
        const batchSize = Math.min(BATCH_SIZE, this.queue.length);
        batchesToProcess.push(this.queue.splice(0, batchSize));
      }

      try {
        // Process all batches in parallel
        await Promise.all(batchesToProcess.map(batch => this.processBatch(batch)));
      } catch (error) {
        console.error('Error writing to database:', error);
        // Re-queue failed items
        for (const batch of batchesToProcess.reverse()) {
          this.queue.unshift(...batch);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Final drain notification
    while (this.drainResolvers.length > 0) {
      const resolver = this.drainResolvers.shift();
      if (resolver) resolver();
    }
  }

  private async processBatch(batch: BlockData[]): Promise<void> {
    // Group all data for bulk operations
    const blocks: Block[] = [];
    const transactions: Transaction[] = [];
    const receipts: TransactionReceipt[] = [];
    const logs: Array<{ log: Log; decodedEvent?: any }> = [];
    const addresses: Address[] = [];
    const addressTxs: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }> = [];
    const contracts: Contract[] = [];
    const erc20Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; value: string }> = [];
    const erc721Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; tokenId: string }> = [];
    const erc1155Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; operator: string; from: string; to: string; tokenId: string; value: string }> = [];
    const erc20Tokens: ERC20Token[] = [];
    const erc721Tokens: ERC721Token[] = [];
    const erc1155Tokens: ERC1155Token[] = [];

    // Aggregate all data from batch
    for (const item of batch) {
      if (item.type === 'block' && item.data) {
        blocks.push(item.data);
      } else if (item.type === 'full_block') {
        if (item.block) blocks.push(item.block);
        if (item.transactions) transactions.push(...item.transactions);
        if (item.receipts) receipts.push(...item.receipts);
        if (item.logs) logs.push(...item.logs);
        if (item.addresses) addresses.push(...item.addresses);
        if (item.addressTxs) addressTxs.push(...item.addressTxs);
        if (item.contracts) contracts.push(...item.contracts);
        if (item.erc20Transfers) erc20Transfers.push(...item.erc20Transfers);
        if (item.erc721Transfers) erc721Transfers.push(...item.erc721Transfers);
        if (item.erc1155Transfers) erc1155Transfers.push(...item.erc1155Transfers);
        if (item.erc20Tokens) erc20Tokens.push(...item.erc20Tokens);
        if (item.erc721Tokens) erc721Tokens.push(...item.erc721Tokens);
        if (item.erc1155Tokens) erc1155Tokens.push(...item.erc1155Tokens);
      }
    }

    // Use fast PostgreSQL batch inserts if available
    if (this.pgPool) {
      await this.processBatchPostgres(blocks, transactions, receipts, logs, addresses, addressTxs, contracts, erc20Transfers, erc721Transfers, erc1155Transfers, erc20Tokens, erc721Tokens, erc1155Tokens);
    } else {
      await this.processBatchGeneric(blocks, transactions, receipts, logs, addresses, addressTxs, contracts, erc20Transfers, erc721Transfers);
    }
  }

  private async processBatchPostgres(
    blocks: Block[],
    transactions: Transaction[],
    receipts: TransactionReceipt[],
    logs: Array<{ log: Log; decodedEvent?: any }>,
    addresses: Address[],
    addressTxs: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }>,
    contracts: Contract[],
    erc20Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; value: string }>,
    erc721Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; tokenId: string }>,
    erc1155Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; operator: string; from: string; to: string; tokenId: string; value: string }>,
    erc20Tokens: ERC20Token[],
    erc721Tokens: ERC721Token[],
    erc1155Tokens: ERC1155Token[]
  ): Promise<void> {
    const client = await this.pgPool!.connect();

    try {
      await client.query('BEGIN');

      // Batch insert blocks (single INSERT with multiple VALUES)
      if (blocks.length > 0) {
        const blockRows = blocks.map(block => [
          block.number, block.hash, block.parentHash, block.nonce || null,
          block.sha3Uncles, block.logsBloom, block.transactionsRoot, block.stateRoot,
          block.receiptsRoot, block.miner, block.difficulty, block.totalDifficulty,
          block.extraData, block.size, block.gasLimit, block.gasUsed, block.timestamp,
          block.baseFeePerGas || null, block.transactions.length
        ]);

        await batchInsertChunked(
          client,
          'blocks',
          ['number', 'hash', 'parent_hash', 'nonce', 'sha3_uncles', 'logs_bloom',
           'transactions_root', 'state_root', 'receipts_root', 'miner', 'difficulty',
           'total_difficulty', 'extra_data', 'size', 'gas_limit', 'gas_used',
           'timestamp', 'base_fee_per_gas', 'transaction_count'],
          blockRows,
          'ON CONFLICT (number) DO NOTHING'
        );
      }

      // Batch insert transactions
      if (transactions.length > 0) {
        const receiptMap = new Map<string, TransactionReceipt>();
        receipts.forEach(r => receiptMap.set(r.transactionHash, r));

        const txRows = transactions.map(tx => {
          const receipt = receiptMap.get(tx.hash);
          return [
            tx.hash, tx.blockNumber, tx.blockHash, tx.transactionIndex,
            tx.from.toLowerCase(), tx.to?.toLowerCase() || null, tx.value,
            tx.gas, tx.gasPrice || null, tx.maxFeePerGas || null,
            tx.maxPriorityFeePerGas || null, tx.input, tx.nonce, tx.type,
            tx.chainId || null, tx.v, tx.r, tx.s,
            tx.accessList ? JSON.stringify(tx.accessList) : null,
            receipt?.status || 1, receipt?.gasUsed || 0, receipt?.cumulativeGasUsed || 0,
            receipt?.effectiveGasPrice || null, receipt?.contractAddress || null,
            receipt?.logs.length || 0
          ];
        });

        await batchInsertChunked(
          client,
          'transactions',
          ['hash', 'block_number', 'block_hash', 'transaction_index', 'from_address',
           'to_address', 'value', 'gas', 'gas_price', 'max_fee_per_gas',
           'max_priority_fee_per_gas', 'input', 'nonce', 'type', 'chain_id',
           'v', 'r', 's', 'access_list', 'status', 'gas_used', 'cumulative_gas_used',
           'effective_gas_price', 'contract_address', 'logs_count'],
          txRows,
          'ON CONFLICT (hash) DO NOTHING',
          50 // 25 columns * 50 rows = 1250 params
        );
      }

      // Batch insert logs (no unique constraint, just insert)
      if (logs.length > 0) {
        const logRows = logs.map(({ log, decodedEvent }) => [
          log.transactionHash, log.logIndex, log.blockNumber, log.blockHash,
          log.address.toLowerCase(), log.data,
          log.topics[0] || null, log.topics[1] || null, log.topics[2] || null,
          log.topics[3] || null, log.removed ? 1 : 0,
          decodedEvent?.eventName || null, decodedEvent?.eventSignature || null,
          decodedEvent?.standard || null, decodedEvent?.params ? JSON.stringify(decodedEvent.params) : null
        ]);

        await batchInsertChunked(
          client,
          'logs',
          ['transaction_hash', 'log_index', 'block_number', 'block_hash',
           'address', 'data', 'topic0', 'topic1', 'topic2', 'topic3', 'removed',
           'event_name', 'event_signature', 'event_standard', 'decoded_params'],
          logRows,
          undefined,  // No ON CONFLICT - schema doesn't have unique constraint
          200
        );
      }

      // Batch insert addresses (deduplicate first to avoid ON CONFLICT hitting same row twice)
      if (addresses.length > 0) {
        // Deduplicate addresses - keep first occurrence (lowest block number)
        const uniqueAddresses = new Map<string, Address>();
        for (const addr of addresses) {
          const key = addr.address.toLowerCase();
          if (!uniqueAddresses.has(key)) {
            uniqueAddresses.set(key, addr);
          }
        }

        const addrRows = Array.from(uniqueAddresses.values()).map(addr => [
          addr.address.toLowerCase(), addr.firstSeenBlock, addr.firstSeenTx,
          addr.isContract ? 1 : 0, addr.txCount, addr.balance
        ]);

        await batchInsertChunked(
          client,
          'addresses',
          ['address', 'first_seen_block', 'first_seen_tx', 'is_contract', 'tx_count', 'balance'],
          addrRows,
          'ON CONFLICT (address) DO NOTHING',  // Changed to DO NOTHING to avoid deadlocks
          500
        );
      }

      // Batch insert address_transactions (deduplicate to avoid ON CONFLICT issues)
      if (addressTxs.length > 0) {
        // Deduplicate address_transactions
        const uniqueAddrTxs = new Map<string, typeof addressTxs[0]>();
        for (const atx of addressTxs) {
          const key = `${atx.address.toLowerCase()}-${atx.txHash}`;
          if (!uniqueAddrTxs.has(key)) {
            uniqueAddrTxs.set(key, atx);
          } else {
            // Merge isFrom and isTo flags
            const existing = uniqueAddrTxs.get(key)!;
            existing.isFrom = existing.isFrom || atx.isFrom;
            existing.isTo = existing.isTo || atx.isTo;
          }
        }

        const addrTxRows = Array.from(uniqueAddrTxs.values()).map(atx => [
          atx.address.toLowerCase(), atx.txHash, atx.blockNumber,
          atx.isFrom ? 1 : 0, atx.isTo ? 1 : 0
        ]);

        await batchInsertChunked(
          client,
          'address_transactions',
          ['address', 'transaction_hash', 'block_number', 'is_from', 'is_to'],
          addrTxRows,
          'ON CONFLICT (address, transaction_hash) DO NOTHING',
          1000
        );
      }

      // Batch insert ERC20 transfers (no unique constraint)
      if (erc20Transfers.length > 0) {
        const transferRows = erc20Transfers.map(t => [
          t.txHash, t.logIndex, t.blockNumber, t.tokenAddress.toLowerCase(),
          t.from.toLowerCase(), t.to.toLowerCase(), t.value
        ]);

        await batchInsertChunked(
          client,
          'erc20_transfers',
          ['transaction_hash', 'log_index', 'block_number', 'token_address', 'from_address', 'to_address', 'value'],
          transferRows,
          undefined,  // No ON CONFLICT
          500
        );
      }

      // Batch insert ERC721 transfers (no unique constraint)
      if (erc721Transfers.length > 0) {
        const transferRows = erc721Transfers.map(t => [
          t.txHash, t.logIndex, t.blockNumber, t.tokenAddress.toLowerCase(),
          t.from.toLowerCase(), t.to.toLowerCase(), t.tokenId
        ]);

        await batchInsertChunked(
          client,
          'erc721_transfers',
          ['transaction_hash', 'log_index', 'block_number', 'token_address', 'from_address', 'to_address', 'token_id'],
          transferRows,
          undefined,  // No ON CONFLICT
          500
        );
      }

      // Batch insert contracts (deduplicate first)
      if (contracts.length > 0) {
        const uniqueContracts = new Map<string, Contract>();
        for (const c of contracts) {
          const key = c.address.toLowerCase();
          if (!uniqueContracts.has(key)) {
            uniqueContracts.set(key, c);
          }
        }

        const contractRows = Array.from(uniqueContracts.values()).map(c => [
          c.address.toLowerCase(), c.creatorAddress.toLowerCase(), c.creationTxHash,
          c.creationBlockNumber, c.bytecode,
          c.isErc20 ? 1 : 0, c.isErc721 ? 1 : 0, c.isErc1155 ? 1 : 0  // Convert booleans to integers
        ]);

        await batchInsertChunked(
          client,
          'contracts',
          ['address', 'creator_address', 'creation_tx_hash', 'creation_block_number',
           'bytecode', 'is_erc20', 'is_erc721', 'is_erc1155'],
          contractRows,
          'ON CONFLICT (address) DO NOTHING',
          50
        );
      }

      // Batch insert ERC1155 transfers (no unique constraint)
      if (erc1155Transfers.length > 0) {
        const transferRows = erc1155Transfers.map(t => [
          t.txHash, t.logIndex, t.blockNumber, t.tokenAddress.toLowerCase(),
          t.operator.toLowerCase(), t.from.toLowerCase(), t.to.toLowerCase(), t.tokenId, t.value
        ]);

        await batchInsertChunked(
          client,
          'erc1155_transfers',
          ['transaction_hash', 'log_index', 'block_number', 'token_address', 'operator_address', 'from_address', 'to_address', 'token_id', 'value'],
          transferRows,
          undefined,  // No ON CONFLICT
          500
        );
      }

      // Batch insert ERC20 token metadata (deduplicate first)
      if (erc20Tokens.length > 0) {
        const uniqueTokens = new Map<string, ERC20Token>();
        for (const t of erc20Tokens) {
          const key = t.address.toLowerCase();
          if (!uniqueTokens.has(key)) {
            uniqueTokens.set(key, t);
          }
        }

        const tokenRows = Array.from(uniqueTokens.values()).map(t => {
          // Validate decimals - must be a reasonable integer (0-255)
          let decimals = t.decimals;
          if (decimals !== null && (decimals < 0 || decimals > 255 || !Number.isInteger(decimals))) {
            decimals = null;  // Invalid decimals, set to null
          }
          return [
            t.address.toLowerCase(), t.name, t.symbol, decimals, t.totalSupply
          ];
        });

        await batchInsertChunked(
          client,
          'erc20_tokens',
          ['address', 'name', 'symbol', 'decimals', 'total_supply'],
          tokenRows,
          'ON CONFLICT (address) DO NOTHING',
          100
        );
      }

      // Batch insert ERC721 token metadata (deduplicate first)
      if (erc721Tokens.length > 0) {
        const uniqueTokens = new Map<string, ERC721Token>();
        for (const t of erc721Tokens) {
          const key = t.address.toLowerCase();
          if (!uniqueTokens.has(key)) {
            uniqueTokens.set(key, t);
          }
        }

        const tokenRows = Array.from(uniqueTokens.values()).map(t => [
          t.address.toLowerCase(), t.name, t.symbol, t.totalSupply
        ]);

        await batchInsertChunked(
          client,
          'erc721_tokens',
          ['address', 'name', 'symbol', 'total_supply'],
          tokenRows,
          'ON CONFLICT (address) DO NOTHING',
          100
        );
      }

      // Batch insert ERC1155 token metadata (deduplicate first)
      if (erc1155Tokens.length > 0) {
        const uniqueTokens = new Map<string, ERC1155Token>();
        for (const t of erc1155Tokens) {
          const key = t.address.toLowerCase();
          if (!uniqueTokens.has(key)) {
            uniqueTokens.set(key, t);
          }
        }

        const tokenRows = Array.from(uniqueTokens.values()).map(t => [
          t.address.toLowerCase(), t.uri
        ]);

        await batchInsertChunked(
          client,
          'erc1155_tokens',
          ['address', 'uri'],
          tokenRows,
          'ON CONFLICT (address) DO NOTHING',
          100
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processBatchGeneric(
    blocks: Block[],
    transactions: Transaction[],
    receipts: TransactionReceipt[],
    logs: Array<{ log: Log; decodedEvent?: any }>,
    addresses: Address[],
    addressTxs: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }>,
    contracts: Contract[],
    erc20Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; value: string }>,
    erc721Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; tokenId: string }>
  ): Promise<void> {
    // Fallback to generic interface (slower but works for SQLite)
    await this.db.beginTransaction();

    try {
      for (const block of blocks) {
        await this.db.insertBlock(block);
      }

      const receiptMap = new Map<string, TransactionReceipt>();
      receipts.forEach(r => receiptMap.set(r.transactionHash, r));

      for (const tx of transactions) {
        const receipt = receiptMap.get(tx.hash);
        if (receipt) {
          await this.db.insertTransaction(tx, receipt);
        }
      }

      if (logs.length > 0 && this.db.bulkInsertLogs) {
        await this.db.bulkInsertLogs(logs);
      } else {
        for (const { log, decodedEvent } of logs) {
          await this.db.insertLog(log, decodedEvent);
        }
      }

      if (addresses.length > 0 && this.db.bulkInsertAddresses) {
        await this.db.bulkInsertAddresses(addresses);
      } else {
        for (const addr of addresses) {
          await this.db.insertAddress(addr);
        }
      }

      if (addressTxs.length > 0 && this.db.bulkInsertAddressTransactions) {
        await this.db.bulkInsertAddressTransactions(addressTxs);
      } else {
        for (const atx of addressTxs) {
          await this.db.insertAddressTransaction(atx.address, atx.txHash, atx.blockNumber, atx.isFrom, atx.isTo);
        }
      }

      for (const contract of contracts) {
        await this.db.insertContract(contract);
      }

      for (const transfer of erc20Transfers) {
        await this.db.insertERC20Transfer(
          transfer.txHash, transfer.logIndex, transfer.blockNumber,
          transfer.tokenAddress, transfer.from, transfer.to, transfer.value
        );
      }

      for (const transfer of erc721Transfers) {
        await this.db.insertERC721Transfer(
          transfer.txHash, transfer.logIndex, transfer.blockNumber,
          transfer.tokenAddress, transfer.from, transfer.to, transfer.tokenId
        );
      }

      await this.db.commit();
    } catch (error) {
      await this.db.rollback();
      throw error;
    }
  }
}
