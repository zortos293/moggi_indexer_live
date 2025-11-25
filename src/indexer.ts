import Piscina from 'piscina';
import { RPCClient } from './rpc-client';
import { createDatabaseManager, IDatabaseManager } from './database-factory';
import { CONFIG } from './config';
import { CLIDashboard } from './cli-dashboard';
import * as path from 'path';

export class MonadIndexer {
  private rpc: RPCClient;
  private db: IDatabaseManager;
  private pool: Piscina;
  private isRunning = false;
  private dashboard: CLIDashboard;

  constructor() {
    this.rpc = new RPCClient(CONFIG.RPC_URL);
    this.db = createDatabaseManager();
    this.dashboard = new CLIDashboard();

    // Create worker pool
    this.pool = new Piscina({
      filename: path.resolve(__dirname, 'worker.js'),
      maxThreads: CONFIG.WORKER_THREADS,
      minThreads: CONFIG.WORKER_THREADS,
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;

    // Get latest block
    const latestBlock = await this.rpc.getLatestBlockNumber();

    // Get current state
    const state = await this.db.getIndexerState();

    // Update latest block
    await this.db.updateIndexerState({ latestBlock });

    // Show dashboard header
    this.dashboard.showHeader(CONFIG.CHAIN_ID, CONFIG.RPC_URL, CONFIG.WORKER_THREADS, CONFIG.BATCH_SIZE);

    // Start bidirectional indexing
    await this.bidirectionalIndex(state.forwardBlock, state.backwardBlock || latestBlock, latestBlock);
  }

  private async bidirectionalIndex(
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

    while (this.isRunning && forwardBlock < backwardBlock) {
      const batchStartTime = Date.now();

      // Create batches for both directions
      const forwardBatch: number[] = [];
      const backwardBatch: number[] = [];

      // Forward batch (from 0 upward)
      for (
        let i = 0;
        i < CONFIG.BATCH_SIZE && forwardBlock + i < backwardBlock;
        i++
      ) {
        forwardBatch.push(forwardBlock + i);
      }

      // Backward batch (from latest downward)
      for (
        let i = 0;
        i < CONFIG.BATCH_SIZE && backwardBlock - i > forwardBlock + forwardBatch.length;
        i++
      ) {
        backwardBatch.push(backwardBlock - i);
      }

      // Process both batches in parallel using worker pool
      const tasks: Promise<any>[] = [];

      // Split batches across workers
      const combinedBatch = [...forwardBatch, ...backwardBatch];
      const blocksPerWorker = Math.ceil(combinedBatch.length / CONFIG.WORKER_THREADS);

      for (let i = 0; i < CONFIG.WORKER_THREADS; i++) {
        const workerBlocks = combinedBatch.slice(
          i * blocksPerWorker,
          (i + 1) * blocksPerWorker
        );

        if (workerBlocks.length > 0) {
          tasks.push(this.pool.run(workerBlocks, { name: 'processBlocks' }));
        }
      }

      // Wait for all workers to complete
      const results = await Promise.all(tasks);

      // Aggregate results
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      const batchProcessed = results.reduce((sum, r) => sum + r.processed, 0);
      totalProcessed += batchProcessed;
      batchCount++;

      // Update progress
      forwardBlock += forwardBatch.length;
      backwardBlock -= backwardBatch.length;

      // Save checkpoint
      await this.db.updateIndexerState({
        forwardBlock,
        backwardBlock,
        isSynced: forwardBlock >= backwardBlock,
      });

      // Calculate stats
      const batchTime = Date.now() - batchStartTime;
      const totalTime = Date.now() - startTime;
      const blocksPerSecond = totalProcessed / (totalTime / 1000);

      // Update dashboard
      this.dashboard.updateProgress({
        forwardBlock,
        backwardBlock,
        latestBlock: backwardStart,
        startBlock: forwardStart,
        totalProcessed,
        blocksPerSecond,
        errorsCount: totalErrors,
        batchTime,
      });

      this.dashboard.showBatchInfo({
        forwardBlock,
        backwardBlock,
        latestBlock: backwardStart,
        startBlock: forwardStart,
        totalProcessed,
        blocksPerSecond,
        errorsCount: totalErrors,
        batchTime,
      });

      // Show database stats every 20 batches
      if (batchCount % 20 === 0) {
        const stats = await this.db.getStats();
        this.dashboard.showDatabaseStats(stats);
      }

      // Check if we need to update latest block (catch up mode)
      if (batchCount % 10 === 0) {
        const currentLatest = await this.rpc.getLatestBlockNumber();
        if (currentLatest > backwardStart) {
          this.dashboard.showNewBlocksDetected(backwardStart, currentLatest);
          this.dashboard.extendTarget(currentLatest);
          backwardBlock = currentLatest;
          backwardStart = currentLatest;
          await this.db.updateIndexerState({ latestBlock: currentLatest, backwardBlock });
        }
      }
    }

    // Mark as synced
    await this.db.updateIndexerState({ isSynced: true });

    const totalTime = (Date.now() - startTime) / 1000;
    const avgSpeed = totalProcessed / totalTime;

    this.dashboard.completeSyncPhase();
    this.dashboard.showFinalStats(totalProcessed, totalTime, avgSpeed);

    const finalStats = await this.db.getStats();
    this.dashboard.showDatabaseStats(finalStats);

    // Continue with live indexing
    await this.liveIndex();
  }

  private async liveIndex(): Promise<void> {
    this.dashboard.startLiveMode();

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
          const blocksPerWorker = Math.ceil(newBlocks.length / CONFIG.WORKER_THREADS);
          const tasks: Promise<any>[] = [];

          for (let i = 0; i < CONFIG.WORKER_THREADS; i++) {
            const workerBlocks = newBlocks.slice(
              i * blocksPerWorker,
              (i + 1) * blocksPerWorker
            );

            if (workerBlocks.length > 0) {
              tasks.push(this.pool.run(workerBlocks, { name: 'processBlocks' }));
            }
          }

          await Promise.all(tasks);

          // Update state
          await this.db.updateIndexerState({
            forwardBlock: latestBlock,
            latestBlock,
          });

          this.dashboard.showLiveBlock(latestBlock, newBlocks.length);
        }

        // Wait 5 seconds before checking for new blocks
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error: any) {
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

        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.dashboard.cleanup();
    await this.pool.destroy();
    await this.db.close();
  }
}
