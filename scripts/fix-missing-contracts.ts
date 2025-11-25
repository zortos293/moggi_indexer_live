import { Pool } from 'pg';
import { CONFIG, EVENT_SIGNATURES } from '../src/config';
import { RPCClient } from '../src/rpc-client';

/**
 * Fix Missing Contracts Script
 *
 * Finds contracts that emit events but aren't in the contracts table,
 * then adds them with proper NFT detection.
 */

async function fetchContractCreation(rpc: RPCClient, pool: Pool, address: string): Promise<{
  creatorAddress: string;
  creationTxHash: string;
  creationBlockNumber: number;
  bytecode: string;
} | null> {
  try {
    // Get bytecode from RPC
    const bytecode = await rpc.getCode(address);
    if (!bytecode || bytecode === '0x') {
      return null; // Not a contract
    }

    // Try to find the first transaction involving this address
    const firstTx = await pool.query(`
      SELECT from_address, hash, block_number
      FROM transactions
      WHERE contract_address = $1
      ORDER BY block_number ASC
      LIMIT 1
    `, [address]);

    if (firstTx.rows.length > 0) {
      return {
        creatorAddress: firstTx.rows[0].from_address,
        creationTxHash: firstTx.rows[0].hash,
        creationBlockNumber: parseInt(firstTx.rows[0].block_number),
        bytecode,
      };
    }

    // If not found in contract_address, try to find first log for this contract
    const firstLog = await pool.query(`
      SELECT transaction_hash, block_number
      FROM logs
      WHERE address = $1
      ORDER BY block_number ASC, log_index ASC
      LIMIT 1
    `, [address]);

    if (firstLog.rows.length > 0) {
      // Get the transaction to find the sender
      const tx = await pool.query(`
        SELECT from_address, hash, block_number
        FROM transactions
        WHERE hash = $1
      `, [firstLog.rows[0].transaction_hash]);

      if (tx.rows.length > 0) {
        return {
          creatorAddress: tx.rows[0].from_address,
          creationTxHash: tx.rows[0].hash,
          creationBlockNumber: parseInt(tx.rows[0].block_number),
          bytecode,
        };
      }
    }

    // Fallback: use unknown creator
    return {
      creatorAddress: '0x0000000000000000000000000000000000000000',
      creationTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      creationBlockNumber: 0,
      bytecode,
    };
  } catch (error) {
    console.error(`Error fetching contract creation for ${address}:`, error);
    return null;
  }
}

async function detectNFTType(rpc: RPCClient, address: string): Promise<{
  isErc721: boolean;
  isErc1155: boolean;
}> {
  try {
    // ERC721: ownerOf(uint256) - 0x6352211e
    const ownerOfCall = '0x6352211e0000000000000000000000000000000000000000000000000000000000000000';
    // ERC721: tokenURI(uint256) - 0xc87b56dd
    const tokenURICall = '0xc87b56dd0000000000000000000000000000000000000000000000000000000000000000';
    // ERC1155: uri(uint256) - 0x0e89341c
    const uriCall = '0x0e89341c0000000000000000000000000000000000000000000000000000000000000000';

    const results = await Promise.allSettled([
      rpc.call(address, ownerOfCall),
      rpc.call(address, tokenURICall),
      rpc.call(address, uriCall),
    ]);

    let hasOwnerOf = false;
    let hasTokenURI = false;
    let hasUri = false;

    if (results[0].status === 'fulfilled') {
      const result = results[0].value as string;
      hasOwnerOf = result && result !== '0x' && result.length >= 42;
    }

    if (results[1].status === 'fulfilled') {
      const result = results[1].value as string;
      hasTokenURI = result && result !== '0x' && result.length > 66;
    }

    if (results[2].status === 'fulfilled') {
      const result = results[2].value as string;
      hasUri = result && result !== '0x' && result.length > 66;
    }

    const isErc721 = hasOwnerOf || hasTokenURI;
    const isErc1155 = hasUri && !hasOwnerOf;

    return { isErc721, isErc1155 };
  } catch {
    return { isErc721: false, isErc1155: false };
  }
}

async function fetchERC721Metadata(rpc: RPCClient, address: string): Promise<{
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;
}> {
  try {
    const calls = [
      rpc.call(address, '0x06fdde03'), // name()
      rpc.call(address, '0x95d89b41'), // symbol()
      rpc.call(address, '0x18160ddd'), // totalSupply()
    ];

    const results = await Promise.allSettled(calls);

    const decodeString = (hex: string): string | null => {
      try {
        if (!hex || hex === '0x' || hex.length < 130) return null;
        const data = hex.slice(2);
        const length = parseInt(data.slice(64, 128), 16);
        if (length === 0 || length > 1000) return null;
        const stringHex = data.slice(128, 128 + length * 2);
        return Buffer.from(stringHex, 'hex').toString('utf8').replace(/\0/g, '').trim() || null;
      } catch {
        return null;
      }
    };

    const decodeUint = (hex: string): string | null => {
      try {
        if (!hex || hex === '0x') return null;
        return BigInt(hex).toString();
      } catch {
        return null;
      }
    };

    return {
      name: results[0].status === 'fulfilled' ? decodeString(results[0].value as string) : null,
      symbol: results[1].status === 'fulfilled' ? decodeString(results[1].value as string) : null,
      totalSupply: results[2].status === 'fulfilled' ? decodeUint(results[2].value as string) : null,
    };
  } catch {
    return { name: null, symbol: null, totalSupply: null };
  }
}

async function fetchERC1155Metadata(rpc: RPCClient, address: string): Promise<{ uri: string | null }> {
  try {
    const uriCall = '0x0e89341c0000000000000000000000000000000000000000000000000000000000000000';
    const result = await rpc.call(address, uriCall);

    if (!result || result === '0x' || result.length < 130) {
      return { uri: null };
    }

    const data = result.slice(2);
    const length = parseInt(data.slice(64, 128), 16);
    if (length === 0 || length > 1000) return { uri: null };

    const stringHex = data.slice(128, 128 + length * 2);
    const uri = Buffer.from(stringHex, 'hex').toString('utf8').replace(/\0/g, '').trim() || null;

    return { uri };
  } catch {
    return { uri: null };
  }
}

async function main() {
  console.log('🔧 Fix Missing Contracts Script\n');
  console.log('Finds contracts with events that are missing from contracts table\n');

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

  const rpc = new RPCClient();

  try {
    console.log('📊 Step 1: Finding contracts with events but missing from contracts table...\n');

    // Find all unique contract addresses from logs that aren't in contracts table
    const missingContractsResult = await pool.query(`
      SELECT DISTINCT l.address, COUNT(*) as event_count
      FROM logs l
      LEFT JOIN contracts c ON l.address = c.address
      WHERE c.address IS NULL
        AND l.address IS NOT NULL
        AND l.address != ''
      GROUP BY l.address
      ORDER BY event_count DESC
      LIMIT 500
    `);

    console.log(`  Found ${missingContractsResult.rows.length} contracts with events but not in contracts table\n`);

    if (missingContractsResult.rows.length === 0) {
      console.log('✅ No missing contracts found!\n');
      return;
    }

    // Focus on NFT contracts first (those with NFT-like events)
    console.log('📊 Step 2: Identifying NFT contracts among missing contracts...\n');

    const nftMissingResult = await pool.query(`
      SELECT DISTINCT l.address,
        COUNT(*) as event_count,
        MAX(CASE WHEN l.topic0 = $1 AND l.topic3 IS NOT NULL THEN 1 ELSE 0 END) as has_erc721,
        MAX(CASE WHEN l.topic0 IN ($2, $3) THEN 1 ELSE 0 END) as has_erc1155
      FROM logs l
      LEFT JOIN contracts c ON l.address = c.address
      WHERE c.address IS NULL
        AND (
          (l.topic0 = $1 AND l.topic3 IS NOT NULL) OR -- ERC721 Transfer
          l.topic0 IN ($2, $3) -- ERC1155 TransferSingle/Batch
        )
      GROUP BY l.address
      ORDER BY event_count DESC
    `, [EVENT_SIGNATURES.Transfer_ERC721, EVENT_SIGNATURES.TransferSingle, EVENT_SIGNATURES.TransferBatch]);

    console.log(`  Found ${nftMissingResult.rows.length} NFT contracts to process\n`);

    let addedCount = 0;
    let erc721Count = 0;
    let erc1155Count = 0;
    let failedCount = 0;

    console.log('📊 Step 3: Adding missing contracts to database...\n');

    const batchSize = 3;
    for (let i = 0; i < nftMissingResult.rows.length; i += batchSize) {
      const batch = nftMissingResult.rows.slice(i, i + batchSize);

      console.log(`  Processing ${i + 1} - ${Math.min(i + batchSize, nftMissingResult.rows.length)} of ${nftMissingResult.rows.length}...`);

      await Promise.all(batch.map(async (row: { address: string; event_count: string; has_erc721: number; has_erc1155: number }) => {
        try {
          const address = row.address.toLowerCase();
          const hasErc721Events = row.has_erc721 === 1;
          const hasErc1155Events = row.has_erc1155 === 1;

          // Get contract creation info
          const creationInfo = await fetchContractCreation(rpc, pool, address);

          if (!creationInfo) {
            console.log(`    ⚠️  Not a contract or no bytecode: ${address}`);
            return;
          }

          // Detect NFT type
          const nftType = await detectNFTType(rpc, address);

          let isErc721 = nftType.isErc721;
          let isErc1155 = nftType.isErc1155;

          // Fallback: trust event patterns if function detection fails
          if (!isErc721 && !isErc1155) {
            if (hasErc721Events && parseInt(row.event_count) >= 3) {
              isErc721 = true;
            } else if (hasErc1155Events && parseInt(row.event_count) >= 3) {
              isErc1155 = true;
            }
          }

          // Insert into contracts table
          await pool.query(`
            INSERT INTO contracts (
              address, creator_address, creation_tx_hash, creation_block_number,
              bytecode, is_erc20, is_erc721, is_erc1155
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (address) DO UPDATE SET
              is_erc721 = EXCLUDED.is_erc721,
              is_erc1155 = EXCLUDED.is_erc1155
          `, [
            address,
            creationInfo.creatorAddress,
            creationInfo.creationTxHash,
            creationInfo.creationBlockNumber,
            creationInfo.bytecode,
            0, // is_erc20
            isErc721 ? 1 : 0,
            isErc1155 ? 1 : 0,
          ]);

          addedCount++;

          // Insert metadata if NFT
          if (isErc721) {
            const metadata = await fetchERC721Metadata(rpc, address);
            await pool.query(`
              INSERT INTO erc721_tokens (address, name, symbol, total_supply)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (address) DO UPDATE SET
                name = EXCLUDED.name,
                symbol = EXCLUDED.symbol,
                total_supply = EXCLUDED.total_supply
            `, [address, metadata.name, metadata.symbol, metadata.totalSupply]);

            console.log(`    ✅ Added ERC721: ${address} - ${metadata.name || 'Unknown'} (${metadata.symbol || 'N/A'}) [${row.event_count} events]`);
            erc721Count++;
          } else if (isErc1155) {
            const metadata = await fetchERC1155Metadata(rpc, address);
            await pool.query(`
              INSERT INTO erc1155_tokens (address, uri)
              VALUES ($1, $2)
              ON CONFLICT (address) DO UPDATE SET
                uri = EXCLUDED.uri
            `, [address, metadata.uri]);

            console.log(`    ✅ Added ERC1155: ${address} [${row.event_count} events]`);
            erc1155Count++;
          } else {
            console.log(`    ➕ Added contract (not NFT): ${address} [${row.event_count} events]`);
          }
        } catch (error) {
          console.log(`    ❌ Failed: ${row.address} - ${(error as Error).message}`);
          failedCount++;
        }
      }));

      if (i + batchSize < nftMissingResult.rows.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log('\n📈 Summary:');
    console.log(`  → Total contracts added: ${addedCount}`);
    console.log(`  → ERC721 NFTs: ${erc721Count}`);
    console.log(`  → ERC1155 NFTs: ${erc1155Count}`);
    console.log(`  → Other contracts: ${addedCount - erc721Count - erc1155Count}`);
    console.log(`  → Failed to process: ${failedCount}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    console.log('\n✅ Missing contracts fix completed!');
  }
}

main().catch(console.error);
