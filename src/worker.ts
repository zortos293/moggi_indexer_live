import { RPCClient } from './rpc-client';
import { BlockProcessor } from './block-processor';
import { createDatabaseManager } from './database-factory';
import { CONFIG } from './config';

// Worker function for processing blocks
export async function processBlocks(blockNumbers: number[]): Promise<{
  processed: number;
  errors: number;
}> {
  const rpc = new RPCClient(CONFIG.RPC_URL);
  const db = createDatabaseManager(true); // Silent mode for workers
  const processor = new BlockProcessor(rpc, db);

  let processed = 0;
  let errors = 0;

  for (const blockNumber of blockNumbers) {
    try {
      await rpc.retry(() => processor.processBlock(blockNumber));
      processed++;
    } catch (error) {
      console.error(`Failed to process block ${blockNumber}:`, error);
      errors++;
    }
  }

  await db.close();

  return { processed, errors };
}
