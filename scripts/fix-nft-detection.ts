import { Pool } from 'pg';
import { CONFIG, EVENT_SIGNATURES } from '../src/config';
import { RPCClient } from '../src/rpc-client';
import { TokenDetector } from '../src/token-detector';

interface NFTCandidate {
  address: string;
  transferCount: number;
  source: 'erc721_transfer' | 'erc1155_transfer' | 'logs_erc721' | 'logs_erc1155';
}

async function main() {
  console.log('🔍 NFT Detection Script - Scanning database for undetected NFTs...\n');

  // Initialize database connection
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
  const tokenDetector = new TokenDetector(rpc);

  try {
    console.log('📊 Step 1: Finding NFT candidates from transfer events...\n');

    const nftCandidates = new Map<string, NFTCandidate>();

    // Method 1: Check logs table for ERC721 transfers (4 topics = ERC721)
    console.log('  → Scanning logs for ERC721 Transfer events (4 topics)...');
    const erc721LogsResult = await pool.query(`
      SELECT DISTINCT address, COUNT(*) as transfer_count
      FROM logs
      WHERE topic0 = $1
        AND topic3 IS NOT NULL  -- ERC721 has 4 topics (from, to, tokenId indexed)
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

    // Method 2: Check logs table for ERC1155 TransferSingle events
    console.log('  → Scanning logs for ERC1155 TransferSingle events...');
    const erc1155SingleResult = await pool.query(`
      SELECT DISTINCT address, COUNT(*) as transfer_count
      FROM logs
      WHERE topic0 = $1
      GROUP BY address
      ORDER BY transfer_count DESC
    `, [EVENT_SIGNATURES.TransferSingle]);

    console.log(`    Found ${erc1155SingleResult.rows.length} contracts with ERC1155 TransferSingle events`);

    for (const row of erc1155SingleResult.rows) {
      const addr = row.address.toLowerCase();
      if (!nftCandidates.has(addr)) {
        nftCandidates.set(addr, {
          address: addr,
          transferCount: parseInt(row.transfer_count),
          source: 'logs_erc1155',
        });
      }
    }

    // Method 3: Check logs table for ERC1155 TransferBatch events
    console.log('  → Scanning logs for ERC1155 TransferBatch events...');
    const erc1155BatchResult = await pool.query(`
      SELECT DISTINCT address, COUNT(*) as transfer_count
      FROM logs
      WHERE topic0 = $1
      GROUP BY address
      ORDER BY transfer_count DESC
    `, [EVENT_SIGNATURES.TransferBatch]);

    console.log(`    Found ${erc1155BatchResult.rows.length} contracts with ERC1155 TransferBatch events`);

    for (const row of erc1155BatchResult.rows) {
      const addr = row.address.toLowerCase();
      if (!nftCandidates.has(addr)) {
        nftCandidates.set(addr, {
          address: addr,
          transferCount: parseInt(row.transfer_count),
          source: 'logs_erc1155',
        });
      }
    }

    // Method 4: Check existing erc721_transfers table
    console.log('  → Checking erc721_transfers table...');
    const erc721TransfersResult = await pool.query(`
      SELECT DISTINCT token_address, COUNT(*) as transfer_count
      FROM erc721_transfers
      GROUP BY token_address
      ORDER BY transfer_count DESC
    `);

    console.log(`    Found ${erc721TransfersResult.rows.length} contracts in erc721_transfers`);

    for (const row of erc721TransfersResult.rows) {
      const addr = row.token_address.toLowerCase();
      if (!nftCandidates.has(addr)) {
        nftCandidates.set(addr, {
          address: addr,
          transferCount: parseInt(row.transfer_count),
          source: 'erc721_transfer',
        });
      }
    }

    console.log(`\n📋 Total unique NFT candidates: ${nftCandidates.size}\n`);

    // Step 2: Check which candidates are NOT already marked as NFTs in contracts table
    console.log('📊 Step 2: Filtering out already-marked NFTs...\n');

    const candidateAddresses = Array.from(nftCandidates.keys());
    const unmatchedNFTs: NFTCandidate[] = [];

    // Process in chunks to avoid huge queries
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

        if (!contract) {
          // Contract not in database at all
          unmatchedNFTs.push(candidate);
        } else if (!contract.is_erc721 && !contract.is_erc1155) {
          // Contract exists but not marked as NFT
          unmatchedNFTs.push(candidate);
        }
      }
    }

    console.log(`  → Found ${unmatchedNFTs.length} contracts NOT marked as NFTs\n`);

    if (unmatchedNFTs.length === 0) {
      console.log('✅ All NFT contracts are already properly marked!\n');
      return;
    }

    // Step 3: Verify each contract via RPC and update database
    console.log('📊 Step 3: Verifying and updating NFT contracts...\n');

    let erc721Count = 0;
    let erc1155Count = 0;
    let failedCount = 0;

    // Sort by transfer count (most active first)
    unmatchedNFTs.sort((a, b) => b.transferCount - a.transferCount);

    // Process in small batches to avoid overwhelming RPC
    const batchSize = 5;
    for (let i = 0; i < unmatchedNFTs.length; i += batchSize) {
      const batch = unmatchedNFTs.slice(i, i + batchSize);

      console.log(`  Processing ${i + 1} - ${Math.min(i + batchSize, unmatchedNFTs.length)} of ${unmatchedNFTs.length}...`);

      await Promise.all(batch.map(async (candidate) => {
        try {
          // Detect token type
          const types = await tokenDetector.detectTokenType(candidate.address);

          if (types.isErc721) {
            // Fetch metadata
            const metadata = await tokenDetector.fetchERC721Metadata(candidate.address);

            // Update contracts table
            await pool.query(`
              UPDATE contracts
              SET is_erc721 = 1, is_erc20 = 0, is_erc1155 = 0
              WHERE address = $1
            `, [candidate.address]);

            // Insert into erc721_tokens
            await pool.query(`
              INSERT INTO erc721_tokens (address, name, symbol, total_supply)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (address) DO UPDATE SET
                name = EXCLUDED.name,
                symbol = EXCLUDED.symbol,
                total_supply = EXCLUDED.total_supply
            `, [candidate.address, metadata.name, metadata.symbol, metadata.totalSupply]);

            console.log(`    ✅ ERC721: ${candidate.address} - ${metadata.name || 'Unknown'} (${metadata.symbol || 'N/A'})`);
            erc721Count++;
          } else if (types.isErc1155) {
            // Fetch metadata
            const metadata = await tokenDetector.fetchERC1155Metadata(candidate.address);

            // Update contracts table
            await pool.query(`
              UPDATE contracts
              SET is_erc1155 = 1, is_erc20 = 0, is_erc721 = 0
              WHERE address = $1
            `, [candidate.address]);

            // Insert into erc1155_tokens
            await pool.query(`
              INSERT INTO erc1155_tokens (address, uri)
              VALUES ($1, $2)
              ON CONFLICT (address) DO UPDATE SET
                uri = EXCLUDED.uri
            `, [candidate.address, metadata.uri]);

            console.log(`    ✅ ERC1155: ${candidate.address} - URI: ${metadata.uri || 'Not available'}`);
            erc1155Count++;
          } else {
            // Not an NFT, but had transfer events - could be ERC20 with 4 topics or other contract
            console.log(`    ⚠️  Not NFT: ${candidate.address} (${candidate.transferCount} transfers from ${candidate.source})`);
          }
        } catch (error) {
          console.log(`    ❌ Failed: ${candidate.address} - ${(error as Error).message}`);
          failedCount++;
        }
      }));

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < unmatchedNFTs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log('\n📈 Summary:');
    console.log(`  → ERC721 NFTs detected and updated: ${erc721Count}`);
    console.log(`  → ERC1155 NFTs detected and updated: ${erc1155Count}`);
    console.log(`  → Failed to process: ${failedCount}`);
    console.log(`  → Not NFTs (false positives): ${unmatchedNFTs.length - erc721Count - erc1155Count - failedCount}`);

    // Step 4: Additional check - find contracts that might have been missed
    console.log('\n📊 Step 4: Checking for contracts with transfer events but missing from erc721_transfers table...\n');

    const missingTransfersResult = await pool.query(`
      SELECT DISTINCT l.address, c.is_erc721
      FROM logs l
      JOIN contracts c ON l.address = c.address
      WHERE l.topic0 = $1
        AND l.topic3 IS NOT NULL
        AND c.is_erc721 = 1
        AND l.address NOT IN (SELECT DISTINCT token_address FROM erc721_transfers)
      LIMIT 100
    `, [EVENT_SIGNATURES.Transfer_ERC721]);

    if (missingTransfersResult.rows.length > 0) {
      console.log(`  ⚠️  Found ${missingTransfersResult.rows.length} ERC721 contracts with transfers not in erc721_transfers table`);
      console.log('  These transfers need to be re-indexed. Consider running the block processor again or creating a separate script.');
    } else {
      console.log('  ✅ All ERC721 transfers are properly recorded');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    console.log('\n✅ NFT detection script completed!');
  }
}

main().catch(console.error);
