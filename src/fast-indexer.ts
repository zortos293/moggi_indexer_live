import { RPCClient } from './rpc-client';
import { createDatabaseManager, IDatabaseManager } from './database-factory';
import { CONFIG, EVENT_SIGNATURES } from './config';
import { CLIDashboard } from './cli-dashboard';
import { BackgroundDBWriter, BlockData } from './db-writer-queue';
import { EventDecoder } from './event-decoder';
import { TokenDetector } from './token-detector';
import { Pool } from 'pg';
import type { Block, Transaction, TransactionReceipt, Log, Contract, Address, ERC20Token, ERC721Token, ERC1155Token } from './types';

// Fast indexer configuration (uses CONFIG from environment)
const FAST_CONFIG = {
  BLOCKS_PER_BATCH: CONFIG.FAST_BLOCKS_PER_BATCH,      // 100 blocks per RPC batch call
  PARALLEL_REQUESTS: CONFIG.FAST_PARALLEL_REQUESTS,    // 10 parallel requests
  TOTAL_BLOCKS_PER_ROUND: CONFIG.FAST_BLOCKS_PER_BATCH * CONFIG.FAST_PARALLEL_REQUESTS, // 1000 blocks
  DB_WRITE_INTERVAL: CONFIG.FAST_DB_WRITE_INTERVAL,    // Write to DB every 100 blocks
};

export class FastIndexer {
  private rpc: RPCClient;
  private db: IDatabaseManager;
  private dbWriter: BackgroundDBWriter;
  private eventDecoder: EventDecoder;
  private tokenDetector: TokenDetector;
  private isRunning = false;
  private dashboard: CLIDashboard;

  constructor() {
    this.rpc = new RPCClient(CONFIG.RPC_URL);
    this.db = createDatabaseManager();
    this.dbWriter = new BackgroundDBWriter(this.db);
    this.eventDecoder = new EventDecoder();
    this.tokenDetector = new TokenDetector(this.rpc);
    this.dashboard = new CLIDashboard();
  }

  async start(): Promise<void> {
    this.isRunning = true;

    // Start background DB writer
    this.dbWriter.start();

    // Load event signatures from database (if using PostgreSQL)
    if (CONFIG.DB_TYPE === 'postgres') {
      console.log('Loading event signatures from database...');
      const pool = new Pool({
        host: CONFIG.PG_HOST,
        port: CONFIG.PG_PORT,
        database: CONFIG.PG_DATABASE,
        user: CONFIG.PG_USER,
        password: CONFIG.PG_PASSWORD,
        ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : false,
        max: 2,
      });

      try {
        const loaded = await this.eventDecoder.loadFromDatabase(pool);
        console.log(`Loaded ${loaded} additional event signatures from database`);
        console.log(`Total event signatures: ${this.eventDecoder.getSignatureCount()}`);
      } catch (error) {
        console.warn('Failed to load signatures from database:', error);
      } finally {
        await pool.end();
      }
    }

    // Get latest block
    const latestBlock = await this.rpc.getLatestBlockNumber();

    // Get current state
    const state = await this.db.getIndexerState();

    // Update latest block
    await this.db.updateIndexerState({ latestBlock });

    // Show dashboard header
    this.dashboard.showHeader(CONFIG.CHAIN_ID, CONFIG.RPC_URL, FAST_CONFIG.PARALLEL_REQUESTS, FAST_CONFIG.BLOCKS_PER_BATCH);

    console.log(`\n🚀 FAST INDEXER MODE`);
    console.log(`   Blocks per batch: ${FAST_CONFIG.BLOCKS_PER_BATCH}`);
    console.log(`   Parallel requests: ${FAST_CONFIG.PARALLEL_REQUESTS}`);
    console.log(`   Total blocks per round: ${FAST_CONFIG.TOTAL_BLOCKS_PER_ROUND}`);
    console.log(`   Background DB writes: Every ${FAST_CONFIG.DB_WRITE_INTERVAL} blocks\n`);

    // Start fast indexing
    await this.fastIndex(state.forwardBlock, state.backwardBlock || latestBlock, latestBlock);
  }

  private async fastIndex(
    forwardStart: number,
    backwardStart: number,
    latestBlock: number
  ): Promise<void> {
    let forwardBlock = forwardStart;
    let backwardBlock = backwardStart;

    this.dashboard.startSync(forwardBlock, backwardBlock);

    const startTime = Date.now();
    let totalProcessed = 0;
    let batchCount = 0;

    // Start multiple concurrent fetch streams - NEVER WAIT
    const NUM_CONCURRENT_FETCHERS = 2;  // 2 concurrent fetch operations (avoid RPC rate limits)
    const activeFetches: Promise<void>[] = [];
    let lastPrintTime = 0;
    let isPrinting = false;  // Simple lock to prevent concurrent writes

    const fetchNextBatch = async (): Promise<void> => {
      while (this.isRunning && forwardBlock < backwardBlock) {
        // Check if queue is too large - wait for it to drain
        const currentQueueSize = this.dbWriter.getQueueSize();
        if (currentQueueSize > 50000) {
          process.stdout.write(`\r⏸️  Queue at ${currentQueueSize} items - waiting for DB...                                    `);
          await this.dbWriter.waitForDrain();
        }

        const batchStartTime = Date.now();

        // Calculate blocks for this fetch
        const remainingBlocks = backwardBlock - forwardBlock;
        const blocksToProcess = Math.min(FAST_CONFIG.TOTAL_BLOCKS_PER_ROUND, remainingBlocks);
        const halfBlocks = Math.floor(blocksToProcess / 2);

        const forwardBlocks: number[] = [];
        const backwardBlocks: number[] = [];

        // Forward blocks
        for (let i = 0; i < halfBlocks && forwardBlock + i < backwardBlock; i++) {
          forwardBlocks.push(forwardBlock + i);
        }

        // Backward blocks
        for (let i = 0; i < halfBlocks && backwardBlock - i > forwardBlock + forwardBlocks.length; i++) {
          backwardBlocks.push(backwardBlock - i);
        }

        if (forwardBlocks.length === 0 && backwardBlocks.length === 0) break;

        // Update pointers IMMEDIATELY (optimistic)
        forwardBlock += forwardBlocks.length;
        backwardBlock -= backwardBlocks.length;

        const allBlocks = [...forwardBlocks, ...backwardBlocks];

        // Fire off fetch - don't wait for DB
        try {
          await this.processBlocksParallel(allBlocks);
          totalProcessed += allBlocks.length;
        } catch (error: any) {
          // On RPC errors, roll back the pointers and retry
          if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
            forwardBlock -= forwardBlocks.length;
            backwardBlock += backwardBlocks.length;
            process.stdout.write(`\r⚠️  RPC timeout, retrying in 5s...                                                          `);
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            // Silently skip other errors to keep output clean
          }
        }

        batchCount++;

        // Calculate stats
        const batchTime = Date.now() - batchStartTime;
        const totalTime = Date.now() - startTime;
        const blocksPerSecond = totalProcessed / (totalTime / 1000);

        // Only print every 500ms to avoid spam (single line update)
        const now = Date.now();
        if (now - lastPrintTime > 500 && !isPrinting) {
          isPrinting = true;
          lastPrintTime = now;
          const queueSize = this.dbWriter.getQueueSize();
          const gap = backwardBlock - forwardBlock;
          const eta = gap / blocksPerSecond;
          const etaStr = eta > 3600 ? `${(eta/3600).toFixed(1)}h` : `${(eta/60).toFixed(0)}m`;

          // Use carriage return to overwrite line - clear entire line first
          const status = `${blocksPerSecond.toFixed(0).padStart(5)} bl/s | Gap: ${gap.toLocaleString().padStart(12)} | ETA: ${etaStr.padStart(6)} | Queue: ${queueSize.toString().padStart(6)} | Done: ${totalProcessed.toLocaleString().padStart(12)}`;
          process.stdout.write(`\r${status}${' '.repeat(Math.max(0, 120 - status.length))}`);
          isPrinting = false;
        }

        // Save checkpoint every 100 batches
        if (batchCount % 100 === 0) {
          this.db.updateIndexerState({
            forwardBlock,
            backwardBlock,
            isSynced: forwardBlock >= backwardBlock,
          }).catch(() => {});
        }

        // Check for new blocks every 200 batches
        if (batchCount % 200 === 0) {
          const currentLatest = await this.rpc.getLatestBlockNumber();
          if (currentLatest > backwardStart) {
            backwardBlock = currentLatest;
            backwardStart = currentLatest;
          }
        }
      }
    };

    // Launch multiple concurrent fetchers
    for (let i = 0; i < NUM_CONCURRENT_FETCHERS; i++) {
      activeFetches.push(fetchNextBatch());
    }

    // Wait for all fetchers to complete
    await Promise.all(activeFetches);

    // Final checkpoint
    await this.db.updateIndexerState({
      forwardBlock,
      backwardBlock,
      isSynced: forwardBlock >= backwardBlock,
    });

    // Wait for DB writer to finish
    console.log('\n⏳ Waiting for background DB writes to complete...');
    await this.dbWriter.waitForDrain();

    // Mark as synced
    await this.db.updateIndexerState({ isSynced: true });

    const totalTime = (Date.now() - startTime) / 1000;
    const avgSpeed = totalProcessed / totalTime;

    this.dashboard.completeSyncPhase();
    this.dashboard.showFinalStats(totalProcessed, totalTime, avgSpeed);

    // Skip expensive stats query - just show completion
    console.log('✅ Sync complete!');

    // Continue with live indexing
    await this.liveIndex();
  }

  private async processBlocksParallel(blockNumbers: number[]): Promise<void> {
    // Split blocks into chunks for parallel processing
    const chunkSize = FAST_CONFIG.BLOCKS_PER_BATCH;
    const chunks: number[][] = [];

    for (let i = 0; i < blockNumbers.length; i += chunkSize) {
      chunks.push(blockNumbers.slice(i, i + chunkSize));
    }

    // Limit to PARALLEL_REQUESTS concurrent fetches
    const parallelChunks = chunks.slice(0, FAST_CONFIG.PARALLEL_REQUESTS);

    // Fire ALL requests at once - no delays, maximum speed
    const batchPromises = parallelChunks.map(chunk => this.fetchAndProcessChunk(chunk));
    await Promise.all(batchPromises);
  }

  private async fetchAndProcessChunk(blockNumbers: number[]): Promise<void> {
    if (blockNumbers.length === 0) return;

    const startBlock = Math.min(...blockNumbers);
    const endBlock = Math.max(...blockNumbers);

    try {
      // 1. Fetch blocks WITH transactions in one batch call (saves separate tx fetch)
      const blocksWithTxs = await this.rpc.retry(() =>
        this.rpc.getBlocksWithTransactions(startBlock, endBlock)
      );

      // 2. Collect all transaction hashes for receipt fetching
      const allTxHashes: string[] = [];
      const txMap = new Map<string, Transaction>();
      const blockList: Block[] = [];

      for (const { block, transactions } of blocksWithTxs) {
        blockList.push(block);
        for (const tx of transactions) {
          allTxHashes.push(tx.hash);
          txMap.set(tx.hash, tx);
        }
      }

      if (allTxHashes.length === 0) {
        // No transactions, just insert empty blocks
        for (const block of blockList) {
          this.dbWriter.enqueue({ type: 'block', data: block });
        }
        return;
      }

      // 3. Fetch receipts with higher concurrency (receipts are lighter weight)
      const receipts = await this.rpc.retry(() =>
        this.rpc.getReceiptsHighConcurrency(allTxHashes, 15) // Reduced to 15 concurrent receipt fetches
      );

      // Create receipt map
      const receiptMap = new Map<string, TransactionReceipt>();
      receipts.forEach(r => receiptMap.set(r.transactionHash, r));

      // 4. Process each block's data and queue for DB write
      for (const block of blockList) {
        const blockData = await this.processBlockData(block, txMap, receiptMap);
        this.dbWriter.enqueue(blockData);
      }

      // Clear maps to help garbage collection
      txMap.clear();
      receiptMap.clear();

    } catch (error) {
      console.error(`Error fetching chunk ${startBlock}-${endBlock}:`, error);
      throw error;
    }
  }

  private async processBlockData(
    block: Block,
    txMap: Map<string, Transaction>,
    receiptMap: Map<string, TransactionReceipt>
  ): Promise<BlockData> {
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

    const addressSet = new Set<string>();
    const contractAddresses = new Set<string>();

    // Process each transaction
    for (const txHash of block.transactions) {
      const tx = txMap.get(txHash);
      const receipt = receiptMap.get(txHash);

      if (!tx || !receipt) continue;

      transactions.push(tx);
      receipts.push(receipt);

      // Track addresses
      addressSet.add(tx.from);
      if (tx.to) addressSet.add(tx.to);

      // Address transactions
      addressTxs.push({ address: tx.from, txHash: tx.hash, blockNumber: tx.blockNumber, isFrom: true, isTo: false });
      if (tx.to) {
        addressTxs.push({ address: tx.to, txHash: tx.hash, blockNumber: tx.blockNumber, isFrom: false, isTo: true });
      }

      // Contract creation
      if (receipt.contractAddress) {
        contractAddresses.add(receipt.contractAddress);
        addressSet.add(receipt.contractAddress);
      }

      // Process logs
      for (const log of receipt.logs) {
        const decodedEvent = this.eventDecoder.decodeLog(log);
        logs.push({ log, decodedEvent: decodedEvent || undefined });
        addressSet.add(log.address);

        // Parse token transfers
        this.parseTokenTransferFast(log, erc20Transfers, erc721Transfers, erc1155Transfers);
      }
    }

    // Build addresses array
    for (const address of addressSet) {
      const isContract = contractAddresses.has(address);
      const firstTx = transactions.find(tx => tx.from === address || tx.to === address);

      if (firstTx) {
        addresses.push({
          address,
          firstSeenBlock: block.number,
          firstSeenTx: firstTx.hash,
          isContract,
          txCount: 1,
          balance: '0',
        });
      }
    }

    // Process contracts (full - with bytecode and token detection)
    if (contractAddresses.size > 0) {
      const contractAddressArray = Array.from(contractAddresses);

      // Fetch bytecode in batch
      const bytecodes = await this.rpc.getCodeBatch(contractAddressArray);

      // Detect token types and fetch metadata in batch
      const tokenDetections = await this.tokenDetector.batchDetectTokens(contractAddressArray);

      for (let i = 0; i < contractAddressArray.length; i++) {
        const contractAddress = contractAddressArray[i];
        const bytecode = bytecodes[i] || '0x';

        const receipt = receipts.find(r => r.contractAddress === contractAddress);
        if (!receipt) continue;

        const tx = transactions.find(t => t.hash === receipt.transactionHash);
        if (!tx) continue;

        const detection = tokenDetections.get(contractAddress) || {
          isErc20: false,
          isErc721: false,
          isErc1155: false,
        };

        contracts.push({
          address: contractAddress,
          creatorAddress: tx.from,
          creationTxHash: tx.hash,
          creationBlockNumber: block.number,
          bytecode,
          isErc20: detection.isErc20,
          isErc721: detection.isErc721,
          isErc1155: detection.isErc1155,
        });

        // Collect token metadata
        if (detection.metadata) {
          if (detection.isErc20 && 'decimals' in detection.metadata) {
            erc20Tokens.push(detection.metadata as ERC20Token);
          } else if (detection.isErc721 && 'symbol' in detection.metadata && !('decimals' in detection.metadata)) {
            erc721Tokens.push(detection.metadata as ERC721Token);
          } else if (detection.isErc1155 && 'uri' in detection.metadata) {
            erc1155Tokens.push(detection.metadata as ERC1155Token);
          }
        }
      }
    }

    return {
      type: 'full_block',
      block,
      transactions,
      receipts,
      logs,
      addresses,
      addressTxs,
      contracts,
      erc20Transfers,
      erc721Transfers,
      erc1155Transfers,
      erc20Tokens,
      erc721Tokens,
      erc1155Tokens,
    };
  }

  private parseTokenTransferFast(
    log: Log,
    erc20Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; value: string }>,
    erc721Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; from: string; to: string; tokenId: string }>,
    erc1155Transfers: Array<{ txHash: string; logIndex: number; blockNumber: number; tokenAddress: string; operator: string; from: string; to: string; tokenId: string; value: string }>
  ): void {
    const topic0 = log.topics[0];
    if (!topic0) return;

    try {
      // ERC20 Transfer (3 topics)
      if (topic0 === EVENT_SIGNATURES.Transfer_ERC20 && log.topics.length === 3) {
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        erc20Transfers.push({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          tokenAddress: log.address,
          from,
          to,
          value: log.data,
        });
      }

      // ERC721 Transfer (4 topics)
      if (topic0 === EVENT_SIGNATURES.Transfer_ERC721 && log.topics.length === 4) {
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        erc721Transfers.push({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          tokenAddress: log.address,
          from,
          to,
          tokenId: log.topics[3],
        });
      }

      // ERC1155 TransferSingle
      if (topic0 === EVENT_SIGNATURES.TransferSingle && log.topics.length === 4) {
        const operator = '0x' + log.topics[1].slice(26);
        const from = '0x' + log.topics[2].slice(26);
        const to = '0x' + log.topics[3].slice(26);
        // Data contains: tokenId (32 bytes) + value (32 bytes)
        if (log.data.length >= 130) { // 0x + 64 + 64
          const tokenId = '0x' + log.data.slice(2, 66);
          const value = '0x' + log.data.slice(66, 130);
          erc1155Transfers.push({
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
            tokenAddress: log.address,
            operator,
            from,
            to,
            tokenId,
            value,
          });
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
  }

  private async liveIndex(): Promise<void> {
    this.dashboard.startLiveMode();

    while (this.isRunning) {
      // Try to use WebSocket subscriptions for instant block notifications
      const wsEnabled = await this.rpc.initWebSocket();

      if (wsEnabled) {
        // WebSocket mode - instant block notifications!
        console.log('🔌 Using WebSocket subscriptions for instant block notifications');
        await this.liveIndexWebSocket();
        console.log('⚠️ WebSocket connection lost or stalled. Reconnecting...');
      } else {
        // Fallback to polling mode
        console.log('🔄 Using polling mode (100ms interval)');
        await this.liveIndexPolling();
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // WebSocket-based live indexing (instant notifications)
  private async liveIndexWebSocket(): Promise<void> {
    let isProcessing = false;
    let lastBlockTime = Date.now();

    const unsubscribe = this.rpc.subscribeToBlocks(async (blockNumber: number) => {
      lastBlockTime = Date.now();

      // Prevent concurrent processing
      if (isProcessing) return;
      isProcessing = true;

      try {
        const state = await this.db.getIndexerState();

        if (blockNumber > (state.forwardBlock || 0)) {
          const newBlocks: number[] = [];
          for (let i = (state.forwardBlock || 0) + 1; i <= blockNumber; i++) {
            newBlocks.push(i);
          }

        // Process new blocks
        const processPromise = this.processBlocksParallel(newBlocks);

        // Update state
        await this.db.updateIndexerState({
          forwardBlock: blockNumber,
          latestBlock: blockNumber,
        });

        this.dashboard.showLiveBlock(blockNumber, newBlocks.length);
        
        // Wait for processing to complete
        await processPromise;
        }
      } catch (error: any) {
        this.handleLiveIndexError(error);
      } finally {
        isProcessing = false;
      }
    });

    // Keep running until stopped
    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Watchdog: Check if we haven't received a block in 60 seconds
      if (Date.now() - lastBlockTime > 60000) {
        console.warn('\n⚠️  WebSocket watchdog: No blocks received for 60s. Reconnecting...');
        break;
      }
    }

    unsubscribe();
    await this.rpc.closeWebSocket();
  }

  // Polling-based live indexing (fallback)
  private async liveIndexPolling(): Promise<void> {
    while (this.isRunning) {
      try {
        const state = await this.db.getIndexerState();
        const latestBlock = await this.rpc.getLatestBlockNumber();

        if (latestBlock > (state.forwardBlock || 0)) {
          const newBlocks: number[] = [];
          for (let i = (state.forwardBlock || 0) + 1; i <= latestBlock; i++) {
            newBlocks.push(i);
          }

          // Process new blocks
          await this.processBlocksParallel(newBlocks);

          // Update state
          await this.db.updateIndexerState({
            forwardBlock: latestBlock,
            latestBlock,
          });

          this.dashboard.showLiveBlock(latestBlock, newBlocks.length);
        }

        // Wait before checking for new blocks (100ms for near-instant indexing)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        this.handleLiveIndexError(error);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private handleLiveIndexError(error: any): void {
    // Enhanced error logging
    let errorDetails = 'Live indexing error: ';

    if (error.response) {
      // HTTP error from axios
      errorDetails += `HTTP ${error.response.status} - ${error.response.statusText}\n`;
      errorDetails += `URL: ${error.config?.url}\n`;
      errorDetails += `Method: ${error.config?.method}\n`;
      if (error.response.data) {
        errorDetails += `Response: ${JSON.stringify(error.response.data, null, 2)}\n`;
      }
    } else if (error.message) {
      errorDetails += error.message + '\n';
    } else {
      errorDetails += String(error) + '\n';
    }

    if (error.stack) {
      errorDetails += `Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`;
    }

    this.dashboard.showError(errorDetails);
    console.error('\n=== DETAILED ERROR ===');
    console.error(errorDetails);
    console.error('=====================\n');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('\n🛑 Stopping indexer...');
    await this.rpc.closeWebSocket();
    await this.dbWriter.stop();
    this.dashboard.cleanup();
    await this.db.close();
    console.log('✅ Indexer stopped.');
    process.exit(0);
  }
}
