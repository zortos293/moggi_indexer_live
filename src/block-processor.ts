import { RPCClient } from './rpc-client';
import { TokenDetector } from './token-detector';
import { IDatabaseManager } from './database-factory';
import { EventDecoder } from './event-decoder';
import { EVENT_SIGNATURES } from './config';
import type {
  Block,
  Transaction,
  TransactionReceipt,
  Log,
  Contract,
  Address,
} from './types';

export class BlockProcessor {
  private tokenDetector: TokenDetector;
  private eventDecoder: EventDecoder;

  constructor(
    private rpc: RPCClient,
    private db: IDatabaseManager
  ) {
    this.tokenDetector = new TokenDetector(rpc);
    this.eventDecoder = new EventDecoder();
  }

  async processBlock(blockNumber: number): Promise<void> {
    try {
      // Fetch block
      const block = await this.rpc.getBlockByNumber(blockNumber, false);
      if (!block) {
        console.warn(`Block ${blockNumber} not found`);
        return;
      }

      // Start transaction for atomicity
      await this.db.beginTransaction();

      try {
        // Insert block
        await this.db.insertBlock(block);

        // Fetch all transactions and receipts in batch
        const txHashes = block.transactions;
        if (txHashes.length === 0) {
          await this.db.commit();
          return;
        }

        const [transactions, receipts] = await Promise.all([
          this.rpc.getTransactionsByHashes(txHashes),
          this.rpc.getTransactionReceipts(txHashes),
        ]);

        // Map receipts by hash for quick lookup
        const receiptMap = new Map<string, TransactionReceipt>();
        receipts.forEach(r => receiptMap.set(r.transactionHash, r));

        // Track addresses and contracts
        const addressSet = new Set<string>();
        const contractAddresses = new Set<string>();

        // Collect data for bulk inserts
        const logsToInsert: Array<{ log: Log; decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any } }> = [];
        const addressesToInsert: Address[] = [];
        const addressTxsToInsert: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }> = [];

        // Process each transaction
        for (const tx of transactions) {
          const receipt = receiptMap.get(tx.hash);
          if (!receipt) continue;

          // Insert transaction
          await this.db.insertTransaction(tx, receipt);

          // Track addresses
          addressSet.add(tx.from);
          if (tx.to) addressSet.add(tx.to);

          // Check for contract creation
          if (receipt.contractAddress) {
            contractAddresses.add(receipt.contractAddress);
            addressSet.add(receipt.contractAddress);
          }

          // Collect logs for bulk insert
          for (const log of receipt.logs) {
            const decodedEvent = this.eventDecoder.decodeLog(log);
            logsToInsert.push({ log, decodedEvent: decodedEvent || undefined });
            addressSet.add(log.address);

            // Parse token transfers
            await this.parseTokenTransfer(log, receipt);
          }

          // Collect address transactions
          addressTxsToInsert.push({ address: tx.from, txHash: tx.hash, blockNumber: tx.blockNumber, isFrom: true, isTo: false });
          if (tx.to) {
            addressTxsToInsert.push({ address: tx.to, txHash: tx.hash, blockNumber: tx.blockNumber, isFrom: false, isTo: true });
          }
        }

        // Bulk insert logs
        if (this.db.bulkInsertLogs && logsToInsert.length > 0) {
          await this.db.bulkInsertLogs(logsToInsert);
        } else {
          for (const { log, decodedEvent } of logsToInsert) {
            await this.db.insertLog(log, decodedEvent);
          }
        }

        // Collect addresses for bulk insert
        for (const address of addressSet) {
          const isContract = contractAddresses.has(address);
          const firstTx = transactions.find(
            tx => tx.from === address || tx.to === address
          );

          if (firstTx) {
            addressesToInsert.push({
              address,
              firstSeenBlock: blockNumber,
              firstSeenTx: firstTx.hash,
              isContract,
              txCount: 1,
              balance: '0',
            });
          }
        }

        // Bulk insert addresses
        if (this.db.bulkInsertAddresses && addressesToInsert.length > 0) {
          await this.db.bulkInsertAddresses(addressesToInsert);
        } else {
          for (const addr of addressesToInsert) {
            await this.db.insertAddress(addr);
          }
        }

        // Bulk insert address transactions
        if (this.db.bulkInsertAddressTransactions && addressTxsToInsert.length > 0) {
          await this.db.bulkInsertAddressTransactions(addressTxsToInsert);
        } else {
          for (const tx of addressTxsToInsert) {
            await this.db.insertAddressTransaction(tx.address, tx.txHash, tx.blockNumber, tx.isFrom, tx.isTo);
          }
        }

        // Process contracts (fetch bytecode and detect tokens)
        if (contractAddresses.size > 0) {
          await this.processContracts(
            Array.from(contractAddresses),
            transactions,
            receipts,
            blockNumber
          );
        }

        await this.db.commit();
      } catch (error) {
        await this.db.rollback();
        throw error;
      }
    } catch (error) {
      console.error(`Error processing block ${blockNumber}:`, error);
      throw error;
    }
  }

  private async processContracts(
    contractAddresses: string[],
    transactions: Transaction[],
    receipts: TransactionReceipt[],
    blockNumber: number
  ): Promise<void> {
    // Fetch bytecode in batch
    const bytecodes = await this.rpc.getCodeBatch(contractAddresses);

    // Detect token types in batch
    const tokenDetections = await this.tokenDetector.batchDetectTokens(contractAddresses);

    // Process each contract
    for (let i = 0; i < contractAddresses.length; i++) {
      const address = contractAddresses[i];
      const bytecode = bytecodes[i];

      // Find creation transaction
      const receipt = receipts.find(r => r.contractAddress === address);
      if (!receipt) continue;

      const tx = transactions.find(t => t.hash === receipt.transactionHash);
      if (!tx) continue;

      const detection = tokenDetections.get(address) || {
        isErc20: false,
        isErc721: false,
        isErc1155: false,
      };

      // Insert contract
      const contract: Contract = {
        address,
        creatorAddress: tx.from,
        creationTxHash: tx.hash,
        creationBlockNumber: blockNumber,
        bytecode,
        isErc20: detection.isErc20,
        isErc721: detection.isErc721,
        isErc1155: detection.isErc1155,
      };

      await this.db.insertContract(contract);

      // Insert token metadata
      if (detection.metadata) {
        if (detection.isErc20 && 'decimals' in detection.metadata) {
          await this.db.insertERC20Token(detection.metadata as import('./types').ERC20Token);
        } else if (detection.isErc721 && !('decimals' in detection.metadata) && 'symbol' in detection.metadata) {
          await this.db.insertERC721Token(detection.metadata as import('./types').ERC721Token);
        } else if (detection.isErc1155 && 'uri' in detection.metadata) {
          await this.db.insertERC1155Token(detection.metadata as import('./types').ERC1155Token);
        }
      }
    }
  }

  private async parseTokenTransfer(log: Log, receipt: TransactionReceipt): Promise<void> {
    const topic0 = log.topics[0];
    if (!topic0) return;

    try {
      // ERC20 Transfer
      if (
        topic0 === EVENT_SIGNATURES.Transfer_ERC20 &&
        log.topics.length === 3
      ) {
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        const value = log.data;

        await this.db.insertERC20Transfer(
          log.transactionHash,
          log.logIndex,
          log.blockNumber,
          log.address,
          from,
          to,
          value
        );
      }

      // ERC721 Transfer
      if (
        topic0 === EVENT_SIGNATURES.Transfer_ERC721 &&
        log.topics.length === 4
      ) {
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        const tokenId = log.topics[3];

        await this.db.insertERC721Transfer(
          log.transactionHash,
          log.logIndex,
          log.blockNumber,
          log.address,
          from,
          to,
          tokenId
        );
      }

      // ERC1155 TransferSingle
      if (topic0 === EVENT_SIGNATURES.TransferSingle) {
        // Could parse ERC1155 transfers here if needed
        // Format: TransferSingle(address operator, address from, address to, uint256 id, uint256 value)
      }
    } catch (error) {
      console.error(`Error parsing token transfer in log ${log.logIndex}:`, error);
    }
  }

  async processBlockRange(startBlock: number, endBlock: number): Promise<void> {
    console.log(`Processing blocks ${startBlock} to ${endBlock}`);

    for (let i = startBlock; i <= endBlock; i++) {
      await this.processBlock(i);

      if (i % 100 === 0) {
        console.log(`Processed block ${i}`);
      }
    }
  }
}
