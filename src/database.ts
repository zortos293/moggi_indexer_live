import Database from 'better-sqlite3';
import { CONFIG } from './config';
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

export class DatabaseManager {
  private db: Database.Database;
  private insertBlockStmt: Database.Statement;
  private insertTxStmt: Database.Statement;
  private insertLogStmt: Database.Statement;
  private insertContractStmt: Database.Statement;
  private insertERC20Stmt: Database.Statement;
  private insertERC721Stmt: Database.Statement;
  private insertERC1155Stmt: Database.Statement;
  private insertAddressStmt: Database.Statement;
  private insertAddressTxStmt: Database.Statement;
  private insertERC20TransferStmt: Database.Statement;
  private insertERC721TransferStmt: Database.Statement;
  private updateStateStmt: Database.Statement;

  constructor(dbPath: string = CONFIG.DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('foreign_keys = OFF'); // Disable FK for performance with parallel workers

    // Prepare statements for performance
    this.insertBlockStmt = this.db.prepare(`
      INSERT OR REPLACE INTO blocks (
        number, hash, parent_hash, nonce, sha3_uncles, logs_bloom,
        transactions_root, state_root, receipts_root, miner, difficulty,
        total_difficulty, extra_data, size, gas_limit, gas_used,
        timestamp, base_fee_per_gas, transaction_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertTxStmt = this.db.prepare(`
      INSERT OR REPLACE INTO transactions (
        hash, block_number, block_hash, transaction_index, from_address,
        to_address, value, gas, gas_price, max_fee_per_gas,
        max_priority_fee_per_gas, input, nonce, type, chain_id,
        v, r, s, access_list, status, gas_used, cumulative_gas_used,
        effective_gas_price, contract_address, logs_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertLogStmt = this.db.prepare(`
      INSERT INTO logs (
        transaction_hash, block_number, block_hash, address, log_index,
        data, topic0, topic1, topic2, topic3, removed,
        event_name, event_signature, event_standard, decoded_params
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertContractStmt = this.db.prepare(`
      INSERT OR REPLACE INTO contracts (
        address, creator_address, creation_tx_hash, creation_block_number,
        bytecode, is_erc20, is_erc721, is_erc1155, abi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertERC20Stmt = this.db.prepare(`
      INSERT OR REPLACE INTO erc20_tokens (address, name, symbol, decimals, total_supply)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.insertERC721Stmt = this.db.prepare(`
      INSERT OR REPLACE INTO erc721_tokens (address, name, symbol, total_supply)
      VALUES (?, ?, ?, ?)
    `);

    this.insertERC1155Stmt = this.db.prepare(`
      INSERT OR REPLACE INTO erc1155_tokens (address, uri)
      VALUES (?, ?)
    `);

    this.insertAddressStmt = this.db.prepare(`
      INSERT OR IGNORE INTO addresses (address, first_seen_block, first_seen_tx, is_contract, tx_count)
      VALUES (?, ?, ?, ?, 1)
    `);

    this.insertAddressTxStmt = this.db.prepare(`
      INSERT OR IGNORE INTO address_transactions (address, transaction_hash, block_number, is_from, is_to)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.insertERC20TransferStmt = this.db.prepare(`
      INSERT INTO erc20_transfers (transaction_hash, log_index, block_number, token_address, from_address, to_address, value)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertERC721TransferStmt = this.db.prepare(`
      INSERT INTO erc721_transfers (transaction_hash, log_index, block_number, token_address, from_address, to_address, token_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateStateStmt = this.db.prepare(`
      UPDATE indexer_state SET forward_block = ?, backward_block = ?, latest_block = ?, is_synced = ?, last_updated = unixepoch()
      WHERE id = 1
    `);
  }

  insertBlock(block: Block): void {
    this.insertBlockStmt.run(
      block.number,
      block.hash,
      block.parentHash,
      block.nonce || null,
      block.sha3Uncles,
      block.logsBloom,
      block.transactionsRoot,
      block.stateRoot,
      block.receiptsRoot,
      block.miner,
      block.difficulty,
      block.totalDifficulty,
      block.extraData,
      block.size,
      block.gasLimit,
      block.gasUsed,
      block.timestamp,
      block.baseFeePerGas || null,
      block.transactions.length
    );
  }

  insertTransaction(tx: Transaction, receipt: TransactionReceipt): void {
    this.insertTxStmt.run(
      tx.hash,
      tx.blockNumber,
      tx.blockHash,
      tx.transactionIndex,
      tx.from.toLowerCase(),
      tx.to?.toLowerCase() || null,
      tx.value,
      tx.gas,
      tx.gasPrice || null,
      tx.maxFeePerGas || null,
      tx.maxPriorityFeePerGas || null,
      tx.input,
      tx.nonce,
      tx.type,
      tx.chainId || null,
      tx.v || null,
      tx.r || null,
      tx.s || null,
      tx.accessList ? JSON.stringify(tx.accessList) : null,
      receipt.status,
      receipt.gasUsed,
      receipt.cumulativeGasUsed,
      receipt.effectiveGasPrice,
      receipt.contractAddress?.toLowerCase() || null,
      receipt.logs.length
    );
  }

  insertLog(log: Log, decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any }): void {
    this.insertLogStmt.run(
      log.transactionHash,
      log.blockNumber,
      log.blockHash,
      log.address.toLowerCase(),
      log.logIndex,
      log.data,
      log.topics[0] || null,
      log.topics[1] || null,
      log.topics[2] || null,
      log.topics[3] || null,
      log.removed ? 1 : 0,
      decodedEvent?.eventName || null,
      decodedEvent?.eventSignature || null,
      decodedEvent?.standard || null,
      decodedEvent?.params ? JSON.stringify(decodedEvent.params) : null
    );
  }

  insertContract(contract: Contract, abi?: string): void {
    this.insertContractStmt.run(
      contract.address.toLowerCase(),
      contract.creatorAddress.toLowerCase(),
      contract.creationTxHash,
      contract.creationBlockNumber,
      contract.bytecode,
      contract.isErc20 ? 1 : 0,
      contract.isErc721 ? 1 : 0,
      contract.isErc1155 ? 1 : 0,
      abi || null
    );
  }

  insertERC20Token(token: ERC20Token): void {
    this.insertERC20Stmt.run(
      token.address.toLowerCase(),
      token.name,
      token.symbol,
      token.decimals,
      token.totalSupply
    );
  }

  insertERC721Token(token: ERC721Token): void {
    this.insertERC721Stmt.run(
      token.address.toLowerCase(),
      token.name,
      token.symbol,
      token.totalSupply
    );
  }

  insertERC1155Token(token: ERC1155Token): void {
    this.insertERC1155Stmt.run(token.address.toLowerCase(), token.uri);
  }

  insertAddress(address: Address): void {
    this.insertAddressStmt.run(
      address.address.toLowerCase(),
      address.firstSeenBlock,
      address.firstSeenTx,
      address.isContract ? 1 : 0
    );
  }

  insertAddressTransaction(address: string, txHash: string, blockNumber: number, isFrom: boolean, isTo: boolean): void {
    this.insertAddressTxStmt.run(
      address.toLowerCase(),
      txHash,
      blockNumber,
      isFrom ? 1 : 0,
      isTo ? 1 : 0
    );
  }

  insertERC20Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, value: string): void {
    this.insertERC20TransferStmt.run(
      txHash,
      logIndex,
      blockNumber,
      tokenAddress.toLowerCase(),
      from.toLowerCase(),
      to.toLowerCase(),
      value
    );
  }

  insertERC721Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, tokenId: string): void {
    this.insertERC721TransferStmt.run(
      txHash,
      logIndex,
      blockNumber,
      tokenAddress.toLowerCase(),
      from.toLowerCase(),
      to.toLowerCase(),
      tokenId
    );
  }

  updateIndexerState(state: Partial<IndexerState>): void {
    const current = this.getIndexerState();
    this.updateStateStmt.run(
      state.forwardBlock ?? current.forwardBlock,
      state.backwardBlock ?? current.backwardBlock,
      state.latestBlock ?? current.latestBlock,
      state.isSynced ?? current.isSynced ? 1 : 0
    );
  }

  getIndexerState(): IndexerState {
    const row = this.db.prepare('SELECT * FROM indexer_state WHERE id = 1').get() as any;
    return {
      forwardBlock: row.forward_block,
      backwardBlock: row.backward_block,
      latestBlock: row.latest_block,
      isSynced: row.is_synced === 1,
      lastUpdated: row.last_updated,
    };
  }

  beginTransaction(): void {
    this.db.prepare('BEGIN').run();
  }

  commit(): void {
    this.db.prepare('COMMIT').run();
  }

  rollback(): void {
    this.db.prepare('ROLLBACK').run();
  }

  close(): void {
    this.db.close();
  }

  getStats() {
    const blockCount = this.db.prepare('SELECT COUNT(*) as count FROM blocks').get() as { count: number };
    const txCount = this.db.prepare('SELECT COUNT(*) as count FROM transactions').get() as { count: number };
    const contractCount = this.db.prepare('SELECT COUNT(*) as count FROM contracts').get() as { count: number };
    const erc20Count = this.db.prepare('SELECT COUNT(*) as count FROM erc20_tokens').get() as { count: number };
    const erc721Count = this.db.prepare('SELECT COUNT(*) as count FROM erc721_tokens').get() as { count: number };

    return {
      blocks: blockCount.count,
      transactions: txCount.count,
      contracts: contractCount.count,
      erc20Tokens: erc20Count.count,
      erc721Tokens: erc721Count.count,
    };
  }
}
