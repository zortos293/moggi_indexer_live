import axios, { AxiosInstance } from 'axios';
import { CONFIG } from './config';
import { WebSocketProvider } from 'ethers';
import type { Block, Transaction, TransactionReceipt } from './types';

export class RPCClient {
  private client: AxiosInstance;
  private requestId = 0;
  private wsProvider?: WebSocketProvider;

  constructor(rpcUrl: string = CONFIG.RPC_URL, private wsUrl?: string) {
    this.client = axios.create({
      baseURL: rpcUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.RPC_TIMEOUT,
    });
  }

  // Initialize WebSocket provider for subscriptions
  async initWebSocket(): Promise<boolean> {
    const url = this.wsUrl || CONFIG.WS_URL;
    if (!url) {
      console.warn('⚠️  No WebSocket URL configured, falling back to polling mode');
      return false;
    }

    // Clean up existing provider if any
    await this.closeWebSocket();

    try {
      this.wsProvider = new WebSocketProvider(url);
      await this.wsProvider.getNetwork(); // Test connection
      console.log('✅ WebSocket connection established');
      return true;
    } catch (error: any) {
      console.warn(`⚠️  WebSocket connection failed: ${error.message}`);
      console.warn('   Falling back to polling mode');
      this.wsProvider = undefined;
      return false;
    }
  }

  // Subscribe to new block headers
  subscribeToBlocks(callback: (blockNumber: number) => void): () => void {
    if (!this.wsProvider) {
      throw new Error('WebSocket provider not initialized. Call initWebSocket() first.');
    }

    this.wsProvider.on('block', callback);

    // Return unsubscribe function
    return () => {
      if (this.wsProvider) {
        this.wsProvider.off('block', callback);
      }
    };
  }

  // Close WebSocket connection
  async closeWebSocket(): Promise<void> {
    if (this.wsProvider) {
      await this.wsProvider.destroy();
      this.wsProvider = undefined;
    }
  }

  private async rpcCall<T>(method: string, params: any[]): Promise<T> {
    const response = await this.client.post('', {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    });

    if (response.data.error) {
      throw new Error(`RPC Error: ${response.data.error.message}`);
    }

    return response.data.result;
  }

  private async batchRpcCall<T>(calls: Array<{ method: string; params: any[] }>): Promise<T[]> {
    // Split into smaller chunks if too many calls (RPC limits)
    const MAX_BATCH_SIZE = 50; // Most RPCs have limits around 50-100

    if (calls.length > MAX_BATCH_SIZE) {
      const results: T[] = [];
      for (let i = 0; i < calls.length; i += MAX_BATCH_SIZE) {
        const chunk = calls.slice(i, i + MAX_BATCH_SIZE);
        const chunkResults = await this.batchRpcCall<T>(chunk);
        results.push(...chunkResults);
      }
      return results;
    }

    const batch = calls.map((call, index) => ({
      jsonrpc: '2.0',
      id: this.requestId + index + 1,
      method: call.method,
      params: call.params,
    }));

    this.requestId += calls.length;

    const response = await this.client.post('', batch);

    if (!Array.isArray(response.data)) {
      throw new Error(`Invalid batch response: expected array, got ${typeof response.data}`);
    }

    // Sort by ID to maintain order
    const sortedResults = response.data.sort((a: any, b: any) => a.id - b.id);

    return sortedResults.map((item: any) => {
      if (item.error) {
        throw new Error(`RPC Error: ${item.error.message}`);
      }
      return item.result;
    });
  }

  async getLatestBlockNumber(): Promise<number> {
    const result = await this.rpcCall<string>('eth_blockNumber', []);
    return parseInt(result, 16);
  }

  async getBlockByNumber(blockNumber: number, includeTransactions: boolean = false): Promise<Block | null> {
    const blockHex = '0x' + blockNumber.toString(16);
    const block = await this.rpcCall<any>('eth_getBlockByNumber', [blockHex, includeTransactions]);

    if (!block) return null;

    return this.normalizeBlock(block);
  }

  async getBlocksByRange(startBlock: number, endBlock: number): Promise<Block[]> {
    const calls = [];
    for (let i = startBlock; i <= endBlock; i++) {
      calls.push({
        method: 'eth_getBlockByNumber',
        params: ['0x' + i.toString(16), false],
      });
    }

    const results = await this.batchRpcCall<any>(calls);
    return results.filter(r => r !== null).map(r => this.normalizeBlock(r));
  }

  // Fetch blocks WITH full transaction objects (saves separate tx fetch calls)
  async getBlocksWithTransactions(startBlock: number, endBlock: number): Promise<{ block: Block; transactions: Transaction[] }[]> {
    const calls = [];
    for (let i = startBlock; i <= endBlock; i++) {
      calls.push({
        method: 'eth_getBlockByNumber',
        params: ['0x' + i.toString(16), true], // true = include full transaction objects
      });
    }

    const results = await this.batchRpcCall<any>(calls);
    return results.filter(r => r !== null).map(r => ({
      block: this.normalizeBlock(r),
      transactions: Array.isArray(r.transactions)
        ? r.transactions.filter((tx: any) => typeof tx === 'object').map((tx: any) => this.normalizeTransaction(tx))
        : [],
    }));
  }

  // High-concurrency receipt fetching (receipts are lighter weight)
  async getReceiptsHighConcurrency(txHashes: string[], concurrency: number = 20): Promise<TransactionReceipt[]> {
    const results: TransactionReceipt[] = [];

    for (let i = 0; i < txHashes.length; i += concurrency) {
      const chunk = txHashes.slice(i, i + concurrency);
      const chunkReceipts = await this.getTransactionReceipts(chunk);
      results.push(...chunkReceipts);
    }

    return results;
  }

  async getTransactionByHash(txHash: string): Promise<Transaction | null> {
    const tx = await this.rpcCall<any>('eth_getTransactionByHash', [txHash]);
    if (!tx) return null;
    return this.normalizeTransaction(tx);
  }

  async getTransactionsByHashes(txHashes: string[]): Promise<Transaction[]> {
    const calls = txHashes.map(hash => ({
      method: 'eth_getTransactionByHash',
      params: [hash],
    }));

    const results = await this.batchRpcCall<any>(calls);
    return results.filter(r => r !== null).map(r => this.normalizeTransaction(r));
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const receipt = await this.rpcCall<any>('eth_getTransactionReceipt', [txHash]);
    if (!receipt) return null;
    return this.normalizeReceipt(receipt);
  }

  async getTransactionReceipts(txHashes: string[]): Promise<TransactionReceipt[]> {
    const calls = txHashes.map(hash => ({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    }));

    const results = await this.batchRpcCall<any>(calls);
    return results.filter(r => r !== null).map(r => this.normalizeReceipt(r));
  }

  async getCode(address: string, blockNumber?: number): Promise<string> {
    const blockParam = blockNumber ? '0x' + blockNumber.toString(16) : 'latest';
    return await this.rpcCall<string>('eth_getCode', [address, blockParam]);
  }

  async getCodeBatch(addresses: string[], blockNumber?: number): Promise<string[]> {
    const blockParam = blockNumber ? '0x' + blockNumber.toString(16) : 'latest';
    const calls = addresses.map(address => ({
      method: 'eth_getCode',
      params: [address, blockParam],
    }));

    return await this.batchRpcCall<string>(calls);
  }

  async call(to: string, data: string, blockNumber?: number): Promise<string> {
    const blockParam = blockNumber ? '0x' + blockNumber.toString(16) : 'latest';
    return await this.rpcCall<string>('eth_call', [{ to, data }, blockParam]);
  }

  async callBatch(calls: Array<{ to: string; data: string }>, blockNumber?: number): Promise<string[]> {
    const blockParam = blockNumber ? '0x' + blockNumber.toString(16) : 'latest';
    const rpcCalls = calls.map(call => ({
      method: 'eth_call',
      params: [{ to: call.to, data: call.data }, blockParam],
    }));

    return await this.batchRpcCall<string>(rpcCalls);
  }

  async getLogs(filter: {
    fromBlock?: number;
    toBlock?: number;
    address?: string | string[];
    topics?: Array<string | string[] | null>;
  }): Promise<any[]> {
    const params: any = {};

    if (filter.fromBlock !== undefined) {
      params.fromBlock = '0x' + filter.fromBlock.toString(16);
    }
    if (filter.toBlock !== undefined) {
      params.toBlock = '0x' + filter.toBlock.toString(16);
    }
    if (filter.address) {
      params.address = filter.address;
    }
    if (filter.topics) {
      params.topics = filter.topics;
    }

    return await this.rpcCall<any[]>('eth_getLogs', [params]);
  }

  private normalizeBlock(block: any): Block {
    return {
      number: parseInt(block.number, 16),
      hash: block.hash,
      parentHash: block.parentHash,
      nonce: block.nonce,
      sha3Uncles: block.sha3Uncles,
      logsBloom: block.logsBloom,
      transactionsRoot: block.transactionsRoot,
      stateRoot: block.stateRoot,
      receiptsRoot: block.receiptsRoot,
      miner: block.miner,
      difficulty: block.difficulty,
      totalDifficulty: block.totalDifficulty,
      extraData: block.extraData,
      size: parseInt(block.size, 16),
      gasLimit: parseInt(block.gasLimit, 16),
      gasUsed: parseInt(block.gasUsed, 16),
      timestamp: parseInt(block.timestamp, 16),
      baseFeePerGas: block.baseFeePerGas,
      transactions: Array.isArray(block.transactions)
        ? block.transactions.map((tx: any) => typeof tx === 'string' ? tx : tx.hash)
        : [],
    };
  }

  private normalizeTransaction(tx: any): Transaction {
    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber, 16),
      blockHash: tx.blockHash,
      transactionIndex: parseInt(tx.transactionIndex, 16),
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: parseInt(tx.gas, 16),
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      input: tx.input,
      nonce: parseInt(tx.nonce, 16),
      type: parseInt(tx.type || '0x0', 16),
      chainId: tx.chainId ? parseInt(tx.chainId, 16) : undefined,
      v: tx.v,
      r: tx.r,
      s: tx.s,
      accessList: tx.accessList,
    };
  }

  private normalizeReceipt(receipt: any): TransactionReceipt {
    return {
      transactionHash: receipt.transactionHash,
      transactionIndex: parseInt(receipt.transactionIndex, 16),
      blockHash: receipt.blockHash,
      blockNumber: parseInt(receipt.blockNumber, 16),
      from: receipt.from,
      to: receipt.to,
      cumulativeGasUsed: parseInt(receipt.cumulativeGasUsed, 16),
      gasUsed: parseInt(receipt.gasUsed, 16),
      effectiveGasPrice: receipt.effectiveGasPrice,
      contractAddress: receipt.contractAddress,
      logs: receipt.logs || [],
      logsBloom: receipt.logsBloom,
      status: parseInt(receipt.status, 16),
      type: parseInt(receipt.type || '0x0', 16),
    };
  }

  async retry<T>(fn: () => Promise<T>, attempts: number = CONFIG.RETRY_ATTEMPTS): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
      }
    }
    throw new Error('Max retries exceeded');
  }
}
