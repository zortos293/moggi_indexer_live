import { Pool, PoolClient } from 'pg';
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

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
  max?: number;
}

export class PostgresDatabaseManager {
  private pool: Pool;
  private client: PoolClient | null = null;
  private inTransaction = false;

  constructor(config: PgConfig) {
    this.pool = new Pool({
      ...config,
      max: config.max || 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  private async getClient(): Promise<PoolClient> {
    if (this.client) {
      return this.client;
    }
    return await this.pool.connect();
  }

  private releaseClient(client: PoolClient): void {
    if (!this.client) {
      client.release();
    }
  }

  async insertBlock(block: Block): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO blocks (
          number, hash, parent_hash, nonce, sha3_uncles, logs_bloom,
          transactions_root, state_root, receipts_root, miner, difficulty,
          total_difficulty, extra_data, size, gas_limit, gas_used,
          timestamp, base_fee_per_gas, transaction_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (number) DO UPDATE SET
          hash = EXCLUDED.hash,
          parent_hash = EXCLUDED.parent_hash,
          nonce = EXCLUDED.nonce,
          sha3_uncles = EXCLUDED.sha3_uncles,
          logs_bloom = EXCLUDED.logs_bloom,
          transactions_root = EXCLUDED.transactions_root,
          state_root = EXCLUDED.state_root,
          receipts_root = EXCLUDED.receipts_root,
          miner = EXCLUDED.miner,
          difficulty = EXCLUDED.difficulty,
          total_difficulty = EXCLUDED.total_difficulty,
          extra_data = EXCLUDED.extra_data,
          size = EXCLUDED.size,
          gas_limit = EXCLUDED.gas_limit,
          gas_used = EXCLUDED.gas_used,
          timestamp = EXCLUDED.timestamp,
          base_fee_per_gas = EXCLUDED.base_fee_per_gas,
          transaction_count = EXCLUDED.transaction_count`,
        [
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
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertTransaction(tx: Transaction, receipt: TransactionReceipt): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO transactions (
          hash, block_number, block_hash, transaction_index, from_address,
          to_address, value, gas, gas_price, max_fee_per_gas,
          max_priority_fee_per_gas, input, nonce, type, chain_id,
          v, r, s, access_list, status, gas_used, cumulative_gas_used,
          effective_gas_price, contract_address, logs_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        ON CONFLICT (hash) DO UPDATE SET
          block_number = EXCLUDED.block_number,
          block_hash = EXCLUDED.block_hash,
          transaction_index = EXCLUDED.transaction_index,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          value = EXCLUDED.value,
          gas = EXCLUDED.gas,
          gas_price = EXCLUDED.gas_price,
          max_fee_per_gas = EXCLUDED.max_fee_per_gas,
          max_priority_fee_per_gas = EXCLUDED.max_priority_fee_per_gas,
          input = EXCLUDED.input,
          nonce = EXCLUDED.nonce,
          type = EXCLUDED.type,
          chain_id = EXCLUDED.chain_id,
          v = EXCLUDED.v,
          r = EXCLUDED.r,
          s = EXCLUDED.s,
          access_list = EXCLUDED.access_list,
          status = EXCLUDED.status,
          gas_used = EXCLUDED.gas_used,
          cumulative_gas_used = EXCLUDED.cumulative_gas_used,
          effective_gas_price = EXCLUDED.effective_gas_price,
          contract_address = EXCLUDED.contract_address,
          logs_count = EXCLUDED.logs_count`,
        [
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
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertLog(log: Log, decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any }): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO logs (
          transaction_hash, block_number, block_hash, address, log_index,
          data, topic0, topic1, topic2, topic3, removed,
          event_name, event_signature, event_standard, decoded_params
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
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
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  // Bulk insert methods for better performance
  async bulkInsertLogs(logs: Array<{ log: Log; decodedEvent?: { eventName: string; eventSignature: string; standard: string; params: any } }>): Promise<void> {
    if (logs.length === 0) return;
    const client = await this.getClient();
    try {
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const { log, decodedEvent } of logs) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14})`);
        values.push(
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
        paramIndex += 15;
      }

      await client.query(
        `INSERT INTO logs (
          transaction_hash, block_number, block_hash, address, log_index,
          data, topic0, topic1, topic2, topic3, removed,
          event_name, event_signature, event_standard, decoded_params
        ) VALUES ${placeholders.join(', ')}`,
        values
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async bulkInsertAddresses(addresses: Address[]): Promise<void> {
    if (addresses.length === 0) return;
    const client = await this.getClient();
    try {
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const addr of addresses) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 1)`);
        values.push(
          addr.address.toLowerCase(),
          addr.firstSeenBlock,
          addr.firstSeenTx,
          addr.isContract ? 1 : 0
        );
        paramIndex += 4;
      }

      await client.query(
        `INSERT INTO addresses (address, first_seen_block, first_seen_tx, is_contract, tx_count)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (address) DO NOTHING`,
        values
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async bulkInsertAddressTransactions(txs: Array<{ address: string; txHash: string; blockNumber: number; isFrom: boolean; isTo: boolean }>): Promise<void> {
    if (txs.length === 0) return;
    const client = await this.getClient();
    try {
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const tx of txs) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
        values.push(
          tx.address.toLowerCase(),
          tx.txHash,
          tx.blockNumber,
          tx.isFrom ? 1 : 0,
          tx.isTo ? 1 : 0
        );
        paramIndex += 5;
      }

      await client.query(
        `INSERT INTO address_transactions (address, transaction_hash, block_number, is_from, is_to)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (address, transaction_hash) DO NOTHING`,
        values
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertContract(contract: Contract, abi?: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO contracts (
          address, creator_address, creation_tx_hash, creation_block_number,
          bytecode, is_erc20, is_erc721, is_erc1155, abi
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (address) DO UPDATE SET
          creator_address = EXCLUDED.creator_address,
          creation_tx_hash = EXCLUDED.creation_tx_hash,
          creation_block_number = EXCLUDED.creation_block_number,
          bytecode = EXCLUDED.bytecode,
          is_erc20 = EXCLUDED.is_erc20,
          is_erc721 = EXCLUDED.is_erc721,
          is_erc1155 = EXCLUDED.is_erc1155,
          abi = EXCLUDED.abi`,
        [
          contract.address.toLowerCase(),
          contract.creatorAddress.toLowerCase(),
          contract.creationTxHash,
          contract.creationBlockNumber,
          contract.bytecode,
          contract.isErc20 ? 1 : 0,
          contract.isErc721 ? 1 : 0,
          contract.isErc1155 ? 1 : 0,
          abi || null
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertERC20Token(token: ERC20Token): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO erc20_tokens (address, name, symbol, decimals, total_supply)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (address) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          decimals = EXCLUDED.decimals,
          total_supply = EXCLUDED.total_supply`,
        [
          token.address.toLowerCase(),
          token.name,
          token.symbol,
          token.decimals,
          token.totalSupply
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertERC721Token(token: ERC721Token): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO erc721_tokens (address, name, symbol, total_supply)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (address) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          total_supply = EXCLUDED.total_supply`,
        [
          token.address.toLowerCase(),
          token.name,
          token.symbol,
          token.totalSupply
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertERC1155Token(token: ERC1155Token): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO erc1155_tokens (address, uri)
        VALUES ($1, $2)
        ON CONFLICT (address) DO UPDATE SET
          uri = EXCLUDED.uri`,
        [token.address.toLowerCase(), token.uri]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertAddress(address: Address): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO addresses (address, first_seen_block, first_seen_tx, is_contract, tx_count)
        VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (address) DO NOTHING`,
        [
          address.address.toLowerCase(),
          address.firstSeenBlock,
          address.firstSeenTx,
          address.isContract ? 1 : 0
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertAddressTransaction(address: string, txHash: string, blockNumber: number, isFrom: boolean, isTo: boolean): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO address_transactions (address, transaction_hash, block_number, is_from, is_to)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (address, transaction_hash) DO NOTHING`,
        [
          address.toLowerCase(),
          txHash,
          blockNumber,
          isFrom ? 1 : 0,
          isTo ? 1 : 0
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertERC20Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, value: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO erc20_transfers (transaction_hash, log_index, block_number, token_address, from_address, to_address, value)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          txHash,
          logIndex,
          blockNumber,
          tokenAddress.toLowerCase(),
          from.toLowerCase(),
          to.toLowerCase(),
          value
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async insertERC721Transfer(txHash: string, logIndex: number, blockNumber: number, tokenAddress: string, from: string, to: string, tokenId: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO erc721_transfers (transaction_hash, log_index, block_number, token_address, from_address, to_address, token_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          txHash,
          logIndex,
          blockNumber,
          tokenAddress.toLowerCase(),
          from.toLowerCase(),
          to.toLowerCase(),
          tokenId
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async updateIndexerState(state: Partial<IndexerState>): Promise<void> {
    const client = await this.getClient();
    try {
      const current = await this.getIndexerState();
      await client.query(
        `UPDATE indexer_state SET
          forward_block = $1,
          backward_block = $2,
          latest_block = $3,
          is_synced = $4,
          last_updated = EXTRACT(EPOCH FROM NOW())::BIGINT
        WHERE id = 1`,
        [
          state.forwardBlock ?? current.forwardBlock,
          state.backwardBlock ?? current.backwardBlock,
          state.latestBlock ?? current.latestBlock,
          (state.isSynced ?? current.isSynced) ? 1 : 0
        ]
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async getIndexerState(): Promise<IndexerState> {
    const client = await this.getClient();
    try {
      const result = await client.query('SELECT * FROM indexer_state WHERE id = 1');
      const row = result.rows[0];
      return {
        forwardBlock: row.forward_block ? parseInt(row.forward_block.toString()) : 0,
        backwardBlock: row.backward_block ? parseInt(row.backward_block.toString()) : null,
        latestBlock: row.latest_block ? parseInt(row.latest_block.toString()) : null,
        isSynced: row.is_synced === 1,
        lastUpdated: row.last_updated ? parseInt(row.last_updated.toString()) : 0,
      };
    } finally {
      this.releaseClient(client);
    }
  }

  async beginTransaction(): Promise<void> {
    if (this.client) {
      throw new Error('Transaction already in progress');
    }
    this.client = await this.pool.connect();
    await this.client.query('BEGIN');
    this.inTransaction = true;
  }

  async commit(): Promise<void> {
    if (!this.client || !this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.query('COMMIT');
    this.client.release();
    this.client = null;
    this.inTransaction = false;
  }

  async rollback(): Promise<void> {
    if (!this.client || !this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    await this.client.query('ROLLBACK');
    this.client.release();
    this.client = null;
    this.inTransaction = false;
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
    await this.pool.end();
  }

  async getStats(): Promise<{
    blocks: number;
    transactions: number;
    contracts: number;
    erc20Tokens: number;
    erc721Tokens: number;
  }> {
    const client = await this.getClient();
    try {
      const [blocks, txs, contracts, erc20, erc721] = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM blocks'),
        client.query('SELECT COUNT(*) as count FROM transactions'),
        client.query('SELECT COUNT(*) as count FROM contracts'),
        client.query('SELECT COUNT(*) as count FROM erc20_tokens'),
        client.query('SELECT COUNT(*) as count FROM erc721_tokens'),
      ]);

      return {
        blocks: parseInt(blocks.rows[0].count),
        transactions: parseInt(txs.rows[0].count),
        contracts: parseInt(contracts.rows[0].count),
        erc20Tokens: parseInt(erc20.rows[0].count),
        erc721Tokens: parseInt(erc721.rows[0].count),
      };
    } finally {
      this.releaseClient(client);
    }
  }
}
