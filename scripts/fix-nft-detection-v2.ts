import { Pool } from 'pg';
import { CONFIG, EVENT_SIGNATURES, ERC721_SIGNATURES, ERC1155_SIGNATURES } from '../src/config';
import { RPCClient } from '../src/rpc-client';

/**
 * Enhanced NFT Detection Script
 *
 * Uses multiple methods to detect NFTs:
 * 1. ERC165 interface detection (standard method)
 * 2. Function signature probing (fallback for non-ERC165 contracts)
 * 3. Event pattern analysis (uses transfer event structure as evidence)
 */

interface NFTCandidate {
  address: string;
  transferCount: number;
  source: 'erc721_transfer' | 'erc1155_transfer' | 'logs_erc721' | 'logs_erc1155';
}

async function detectNFTByFunctionSignatures(rpc: RPCClient, address: string): Promise<{
  isErc721: boolean;
  isErc1155: boolean;
}> {
  try {
    // Test ERC721 specific functions: ownerOf(uint256) and tokenURI(uint256)
    // These are NOT in ERC20, so if they exist, it's likely ERC721

    // ownerOf(0) - try to call with token ID 0
    const ownerOfCall = ERC721_SIGNATURES.ownerOf + '0000000000000000000000000000000000000000000000000000000000000000';
    // tokenURI(0)
    const tokenURICall = ERC721_SIGNATURES.tokenURI + '0000000000000000000000000000000000000000000000000000000000000000';

    // Test ERC1155 specific function: uri(uint256)
    const uriCall = ERC1155_SIGNATURES.uri + '0000000000000000000000000000000000000000000000000000000000000000';
    // balanceOf(address, id) - ERC1155 has 2 params, ERC20/721 has 1
    const balanceOfBatchCall = ERC1155_SIGNATURES.balanceOfBatch;

    const results = await Promise.allSettled([
      rpc.call(address, ownerOfCall),
      rpc.call(address, tokenURICall),
      rpc.call(address, uriCall),
      rpc.call(address, balanceOfBatchCall),
    ]);

    // Check if ownerOf or tokenURI returned valid data (not reverted)
    const ownerOfResult = results[0];
    const tokenURIResult = results[1];
    const uriResult = results[2];
    const balanceOfBatchResult = results[3];

    // ERC721 detection: ownerOf or tokenURI should return something or revert with specific error
    // If it returns 0x (no data) or length >= 2 with data, function exists
    let hasOwnerOf = false;
    let hasTokenURI = false;
    let hasUri = false;

    if (ownerOfResult.status === 'fulfilled') {
      const result = ownerOfResult.value as string;
      // ownerOf returns an address (32 bytes = 64 hex chars + 0x = 66 chars)
      // If it returns data, even if it's 0x0 (address zero), it exists
      hasOwnerOf = result && result !== '0x' && result.length >= 42;
    }

    if (tokenURIResult.status === 'fulfilled') {
      const result = tokenURIResult.value as string;
      // tokenURI returns a string, which has offset + length + data
      hasTokenURI = result && result !== '0x' && result.length > 66;
    }

    if (uriResult.status === 'fulfilled') {
      const result = uriResult.value as string;
      // uri returns a string
      hasUri = result && result !== '0x' && result.length > 66;
    }

    // If has ownerOf OR tokenURI, likely ERC721
    const isErc721 = hasOwnerOf || hasTokenURI;

    // If has uri and no ownerOf, likely ERC1155
    const isErc1155 = hasUri && !hasOwnerOf;

    return { isErc721, isErc1155 };
  } catch (error) {
    return { isErc721: false, isErc1155: false };
  }
}

async function fetchERC721MetadataFallback(rpc: RPCClient, address: string): Promise<{
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;
}> {
  try {
    const calls = [
      rpc.call(address, ERC721_SIGNATURES.name),
      rpc.call(address, ERC721_SIGNATURES.symbol),
      rpc.call(address, '0x18160ddd'), // totalSupply
    ];

    const results = await Promise.allSettled(calls);

    const decodeString = (hex: string): string | null => {
      try {
        if (!hex || hex === '0x' || hex.length < 130) return null;
        const data = hex.slice(2);
        const lengthHex = data.slice(64, 128);
        const length = parseInt(lengthHex, 16);
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

async function fetchERC1155MetadataFallback(rpc: RPCClient, address: string): Promise<{
  uri: string | null;
}> {
  try {
    const uriCall = ERC1155_SIGNATURES.uri + '0000000000000000000000000000000000000000000000000000000000000000';
    const result = await rpc.call(address, uriCall);

    if (!result || result === '0x' || result.length < 130) {
      return { uri: null };
    }

    const data = result.slice(2);
    const lengthHex = data.slice(64, 128);
    const length = parseInt(lengthHex, 16);
    if (length === 0 || length > 1000) return { uri: null };

    const stringHex = data.slice(128, 128 + length * 2);
    const uri = Buffer.from(stringHex, 'hex').toString('utf8').replace(/\0/g, '').trim() || null;

    return { uri };
  } catch {
    return { uri: null };
  }
}

async function main() {
  console.log('🔍 Enhanced NFT Detection Script v2\n');
  console.log('Uses multiple detection methods including function signature probing\n');

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
    console.log('📊 Step 1: Finding NFT candidates from transfer events...\n');

    const nftCandidates = new Map<string, NFTCandidate>();

    // Scan logs for ERC721-style transfers (4 topics)
    console.log('  → Scanning logs for ERC721 Transfer events (4 topics)...');
    const erc721LogsResult = await pool.query(`
      SELECT DISTINCT address, COUNT(*) as transfer_count
      FROM logs
      WHERE topic0 = $1
        AND topic3 IS NOT NULL
      GROUP BY address
      ORDER BY transfer_count DESC
    `, [EVENT_SIGNATURES.Transfer_ERC721]);

    console.log(`    Found ${erc721LogsResult.rows.length} contracts with ERC721-style transfers`);

    for (const row of erc721LogsResult.rows) {
      nftCandidates.set(row.address.toLowerCase(), {
        address: row.address.toLowerCase(),
        transferCount: parseInt(row.transfer_count),
        source: 'logs_erc721',
      });
    }

    // Scan for ERC1155 events
    console.log('  → Scanning logs for ERC1155 events...');
    const erc1155Result = await pool.query(`
      SELECT DISTINCT address, COUNT(*) as transfer_count
      FROM logs
      WHERE topic0 IN ($1, $2)
      GROUP BY address
      ORDER BY transfer_count DESC
    `, [EVENT_SIGNATURES.TransferSingle, EVENT_SIGNATURES.TransferBatch]);

    console.log(`    Found ${erc1155Result.rows.length} contracts with ERC1155 events`);

    for (const row of erc1155Result.rows) {
      const addr = row.address.toLowerCase();
      if (!nftCandidates.has(addr)) {
        nftCandidates.set(addr, {
          address: addr,
          transferCount: parseInt(row.transfer_count),
          source: 'logs_erc1155',
        });
      }
    }

    console.log(`\n📋 Total unique NFT candidates: ${nftCandidates.size}\n`);

    // Step 2: Filter out already-marked NFTs
    console.log('📊 Step 2: Filtering out already-marked NFTs...\n');

    const candidateAddresses = Array.from(nftCandidates.keys());
    const unmatchedNFTs: NFTCandidate[] = [];

    const chunkSize = 100;
    for (let i = 0; i < candidateAddresses.length; i += chunkSize) {
      const chunk = candidateAddresses.slice(i, i + chunkSize);

      const contractsResult = await pool.query(`
        SELECT address, is_erc721, is_erc1155
        FROM contracts
        WHERE address = ANY($1)
      `, [chunk]);

      const existingContracts = new Map<string, { is_erc721: boolean; is_erc1155: boolean }>();
      for (const row of contractsResult.rows) {
        existingContracts.set(row.address.toLowerCase(), {
          is_erc721: row.is_erc721 === 1 || row.is_erc721 === true,
          is_erc1155: row.is_erc1155 === 1 || row.is_erc1155 === true,
        });
      }

      for (const addr of chunk) {
        const contract = existingContracts.get(addr);
        const candidate = nftCandidates.get(addr)!;

        if (!contract || (!contract.is_erc721 && !contract.is_erc1155)) {
          unmatchedNFTs.push(candidate);
        }
      }
    }

    console.log(`  → Found ${unmatchedNFTs.length} contracts NOT marked as NFTs\n`);

    if (unmatchedNFTs.length === 0) {
      console.log('✅ All NFT contracts are already properly marked!\n');
      return;
    }

    // Step 3: Verify using function signatures (fallback method)
    console.log('📊 Step 3: Verifying NFTs using function signature detection...\n');

    let erc721Count = 0;
    let erc1155Count = 0;
    let failedCount = 0;
    let notContractCount = 0;

    unmatchedNFTs.sort((a, b) => b.transferCount - a.transferCount);

    const batchSize = 3; // Smaller batch to avoid overwhelming RPC
    for (let i = 0; i < unmatchedNFTs.length; i += batchSize) {
      const batch = unmatchedNFTs.slice(i, i + batchSize);

      console.log(`  Processing ${i + 1} - ${Math.min(i + batchSize, unmatchedNFTs.length)} of ${unmatchedNFTs.length}...`);

      await Promise.all(batch.map(async (candidate) => {
        try {
          // First check if contract exists in DB
          const contractExists = await pool.query(`
            SELECT address FROM contracts WHERE address = $1
          `, [candidate.address]);

          if (contractExists.rows.length === 0) {
            console.log(`    ⚠️  Not in contracts table: ${candidate.address}`);
            notContractCount++;
            return;
          }

          // Use function signature detection
          const types = await detectNFTByFunctionSignatures(rpc, candidate.address);

          if (types.isErc721) {
            const metadata = await fetchERC721MetadataFallback(rpc, candidate.address);

            await pool.query(`
              UPDATE contracts
              SET is_erc721 = 1, is_erc20 = 0, is_erc1155 = 0
              WHERE address = $1
            `, [candidate.address]);

            await pool.query(`
              INSERT INTO erc721_tokens (address, name, symbol, total_supply)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (address) DO UPDATE SET
                name = EXCLUDED.name,
                symbol = EXCLUDED.symbol,
                total_supply = EXCLUDED.total_supply
            `, [candidate.address, metadata.name, metadata.symbol, metadata.totalSupply]);

            console.log(`    ✅ ERC721: ${candidate.address} - ${metadata.name || 'Unknown'} (${metadata.symbol || 'N/A'}) [${candidate.transferCount} transfers]`);
            erc721Count++;
          } else if (types.isErc1155) {
            const metadata = await fetchERC1155MetadataFallback(rpc, candidate.address);

            await pool.query(`
              UPDATE contracts
              SET is_erc1155 = 1, is_erc20 = 0, is_erc721 = 0
              WHERE address = $1
            `, [candidate.address]);

            await pool.query(`
              INSERT INTO erc1155_tokens (address, uri)
              VALUES ($1, $2)
              ON CONFLICT (address) DO UPDATE SET
                uri = EXCLUDED.uri
            `, [candidate.address, metadata.uri]);

            console.log(`    ✅ ERC1155: ${candidate.address} - URI: ${metadata.uri || 'Not available'} [${candidate.transferCount} transfers]`);
            erc1155Count++;
          } else {
            // If still not detected but has 4-topic transfers, trust the event pattern
            if (candidate.source === 'logs_erc721' && candidate.transferCount >= 3) {
              // High confidence: Multiple 4-topic transfers = likely ERC721
              const metadata = await fetchERC721MetadataFallback(rpc, candidate.address);

              await pool.query(`
                UPDATE contracts
                SET is_erc721 = 1, is_erc20 = 0, is_erc1155 = 0
                WHERE address = $1
              `, [candidate.address]);

              await pool.query(`
                INSERT INTO erc721_tokens (address, name, symbol, total_supply)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (address) DO UPDATE SET
                  name = EXCLUDED.name,
                  symbol = EXCLUDED.symbol,
                  total_supply = EXCLUDED.total_supply
              `, [candidate.address, metadata.name, metadata.symbol, metadata.totalSupply]);

              console.log(`    ✅ ERC721 (by event pattern): ${candidate.address} - ${metadata.name || 'Unknown'} (${metadata.symbol || 'N/A'}) [${candidate.transferCount} transfers]`);
              erc721Count++;
            } else if (candidate.source === 'logs_erc1155' && candidate.transferCount >= 3) {
              // High confidence: Multiple ERC1155 events = likely ERC1155
              const metadata = await fetchERC1155MetadataFallback(rpc, candidate.address);

              await pool.query(`
                UPDATE contracts
                SET is_erc1155 = 1, is_erc20 = 0, is_erc721 = 0
                WHERE address = $1
              `, [candidate.address]);

              await pool.query(`
                INSERT INTO erc1155_tokens (address, uri)
                VALUES ($1, $2)
                ON CONFLICT (address) DO UPDATE SET
                  uri = EXCLUDED.uri
              `, [candidate.address, metadata.uri]);

              console.log(`    ✅ ERC1155 (by event pattern): ${candidate.address} [${candidate.transferCount} transfers]`);
              erc1155Count++;
            } else {
              console.log(`    ⚠️  Uncertain: ${candidate.address} (${candidate.transferCount} transfers from ${candidate.source})`);
            }
          }
        } catch (error) {
          console.log(`    ❌ Failed: ${candidate.address} - ${(error as Error).message}`);
          failedCount++;
        }
      }));

      if (i + batchSize < unmatchedNFTs.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log('\n📈 Summary:');
    console.log(`  → ERC721 NFTs detected and updated: ${erc721Count}`);
    console.log(`  → ERC1155 NFTs detected and updated: ${erc1155Count}`);
    console.log(`  → Not in contracts table: ${notContractCount}`);
    console.log(`  → Failed to process: ${failedCount}`);
    console.log(`  → Uncertain (not enough evidence): ${unmatchedNFTs.length - erc721Count - erc1155Count - failedCount - notContractCount}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    console.log('\n✅ Enhanced NFT detection completed!');
  }
}

main().catch(console.error);
