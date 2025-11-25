import { Pool } from 'pg';
import { CONFIG, EVENT_SIGNATURES } from '../src/config';

async function main() {
  console.log('🔄 NFT Transfer Backfill Script\n');
  console.log('This script scans the logs table for ERC721/ERC1155 transfers');
  console.log('and adds them to the respective transfer tables.\n');

  const pool = new Pool({
    host: CONFIG.PG_HOST,
    port: CONFIG.PG_PORT,
    database: CONFIG.PG_DATABASE,
    user: CONFIG.PG_USER,
    password: CONFIG.PG_PASSWORD,
    ssl: CONFIG.PG_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });

  try {
    // Step 1: Backfill ERC721 Transfers
    console.log('📊 Step 1: Backfilling ERC721 transfers from logs...\n');

    // Get all ERC721 contracts
    const erc721Contracts = await pool.query(`
      SELECT address FROM contracts WHERE is_erc721 = 1
    `);
    const erc721Set = new Set(erc721Contracts.rows.map((r: { address: string }) => r.address.toLowerCase()));

    console.log(`  Found ${erc721Set.size} ERC721 contracts in database`);

    // Count existing transfers
    const existingERC721Count = await pool.query(`SELECT COUNT(*) as count FROM erc721_transfers`);
    console.log(`  Existing ERC721 transfers: ${existingERC721Count.rows[0].count}`);

    // Find ERC721 transfer events in logs that are NOT in erc721_transfers
    console.log('  → Scanning logs for missing ERC721 transfers...');

    const missingERC721Result = await pool.query(`
      SELECT
        l.transaction_hash,
        l.log_index,
        l.block_number,
        l.address as token_address,
        l.topic1,
        l.topic2,
        l.topic3
      FROM logs l
      WHERE l.topic0 = $1
        AND l.topic3 IS NOT NULL  -- ERC721 has tokenId as 4th topic
        AND l.address = ANY($2)   -- Only known ERC721 contracts
        AND NOT EXISTS (
          SELECT 1 FROM erc721_transfers t
          WHERE t.transaction_hash = l.transaction_hash
            AND t.log_index = l.log_index
        )
      ORDER BY l.block_number
      LIMIT 10000
    `, [EVENT_SIGNATURES.Transfer_ERC721, Array.from(erc721Set)]);

    console.log(`  Found ${missingERC721Result.rows.length} missing ERC721 transfers to insert`);

    if (missingERC721Result.rows.length > 0) {
      // Batch insert
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < missingERC721Result.rows.length; i += batchSize) {
        const batch = missingERC721Result.rows.slice(i, i + batchSize);

        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const row of batch) {
          // Parse topics: ERC721 Transfer has from, to, tokenId as indexed (3 topics + topic0)
          const fromAddress = '0x' + row.topic1.slice(26);
          const toAddress = '0x' + row.topic2.slice(26);
          const tokenId = BigInt(row.topic3).toString();

          placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`);
          values.push(
            row.transaction_hash,
            row.log_index,
            row.block_number,
            row.token_address.toLowerCase(),
            fromAddress.toLowerCase(),
            toAddress.toLowerCase(),
            tokenId
          );
          paramIndex += 7;
        }

        await pool.query(`
          INSERT INTO erc721_transfers (transaction_hash, log_index, block_number, token_address, from_address, to_address, token_id)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT DO NOTHING
        `, values);

        inserted += batch.length;
        console.log(`    Inserted ${inserted}/${missingERC721Result.rows.length} ERC721 transfers...`);
      }
    }

    // Step 2: Backfill ERC1155 TransferSingle
    console.log('\n📊 Step 2: Backfilling ERC1155 TransferSingle events...\n');

    // Get all ERC1155 contracts
    const erc1155Contracts = await pool.query(`
      SELECT address FROM contracts WHERE is_erc1155 = 1
    `);
    const erc1155Set = new Set(erc1155Contracts.rows.map((r: { address: string }) => r.address.toLowerCase()));

    console.log(`  Found ${erc1155Set.size} ERC1155 contracts in database`);

    // Check if erc1155_transfers table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'erc1155_transfers'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('  ⚠️  erc1155_transfers table does not exist. Creating it...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS erc1155_transfers (
          id BIGSERIAL PRIMARY KEY,
          transaction_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          block_number BIGINT NOT NULL,
          token_address TEXT NOT NULL,
          operator_address TEXT NOT NULL,
          from_address TEXT NOT NULL,
          to_address TEXT NOT NULL,
          token_id TEXT NOT NULL,
          value TEXT NOT NULL,
          indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
          UNIQUE(transaction_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS idx_erc1155_transfers_token ON erc1155_transfers(token_address);
        CREATE INDEX IF NOT EXISTS idx_erc1155_transfers_from ON erc1155_transfers(from_address);
        CREATE INDEX IF NOT EXISTS idx_erc1155_transfers_to ON erc1155_transfers(to_address);
        CREATE INDEX IF NOT EXISTS idx_erc1155_transfers_block ON erc1155_transfers(block_number);
      `);
      console.log('  ✅ erc1155_transfers table created');
    }

    // Count existing ERC1155 transfers
    const existingERC1155Count = await pool.query(`SELECT COUNT(*) as count FROM erc1155_transfers`);
    console.log(`  Existing ERC1155 transfers: ${existingERC1155Count.rows[0].count}`);

    // Find ERC1155 TransferSingle events
    console.log('  → Scanning logs for ERC1155 TransferSingle events...');

    const missingERC1155SingleResult = await pool.query(`
      SELECT
        l.transaction_hash,
        l.log_index,
        l.block_number,
        l.address as token_address,
        l.topic1 as operator,
        l.topic2 as from_addr,
        l.topic3 as to_addr,
        l.data
      FROM logs l
      WHERE l.topic0 = $1
        AND l.address = ANY($2)
        AND NOT EXISTS (
          SELECT 1 FROM erc1155_transfers t
          WHERE t.transaction_hash = l.transaction_hash
            AND t.log_index = l.log_index
        )
      ORDER BY l.block_number
      LIMIT 10000
    `, [EVENT_SIGNATURES.TransferSingle, Array.from(erc1155Set)]);

    console.log(`  Found ${missingERC1155SingleResult.rows.length} missing ERC1155 TransferSingle events`);

    if (missingERC1155SingleResult.rows.length > 0) {
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < missingERC1155SingleResult.rows.length; i += batchSize) {
        const batch = missingERC1155SingleResult.rows.slice(i, i + batchSize);

        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const row of batch) {
          // Parse ERC1155 TransferSingle:
          // topic1 = operator (indexed)
          // topic2 = from (indexed)
          // topic3 = to (indexed)
          // data = id (uint256) + value (uint256)
          const operatorAddress = '0x' + row.operator.slice(26);
          const fromAddress = '0x' + row.from_addr.slice(26);
          const toAddress = '0x' + row.to_addr.slice(26);

          // Data contains id and value (each 32 bytes)
          const dataHex = row.data.slice(2); // Remove '0x'
          const tokenId = BigInt('0x' + dataHex.slice(0, 64)).toString();
          const value = BigInt('0x' + dataHex.slice(64, 128)).toString();

          placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`);
          values.push(
            row.transaction_hash,
            row.log_index,
            row.block_number,
            row.token_address.toLowerCase(),
            operatorAddress.toLowerCase(),
            fromAddress.toLowerCase(),
            toAddress.toLowerCase(),
            tokenId,
            value
          );
          paramIndex += 9;
        }

        await pool.query(`
          INSERT INTO erc1155_transfers (transaction_hash, log_index, block_number, token_address, operator_address, from_address, to_address, token_id, value)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT DO NOTHING
        `, values);

        inserted += batch.length;
        console.log(`    Inserted ${inserted}/${missingERC1155SingleResult.rows.length} ERC1155 transfers...`);
      }
    }

    // Step 3: Summary
    console.log('\n📈 Final Summary:');

    const finalERC721Count = await pool.query(`SELECT COUNT(*) as count FROM erc721_transfers`);
    const finalERC1155Count = await pool.query(`SELECT COUNT(*) as count FROM erc1155_transfers`);

    console.log(`  → Total ERC721 transfers: ${finalERC721Count.rows[0].count}`);
    console.log(`  → Total ERC1155 transfers: ${finalERC1155Count.rows[0].count}`);

    // Check for any remaining unprocessed transfers
    const remainingERC721 = await pool.query(`
      SELECT COUNT(*) as count
      FROM logs l
      WHERE l.topic0 = $1
        AND l.topic3 IS NOT NULL
        AND l.address IN (SELECT address FROM contracts WHERE is_erc721 = 1)
        AND NOT EXISTS (
          SELECT 1 FROM erc721_transfers t
          WHERE t.transaction_hash = l.transaction_hash
            AND t.log_index = l.log_index
        )
    `, [EVENT_SIGNATURES.Transfer_ERC721]);

    if (parseInt(remainingERC721.rows[0].count) > 0) {
      console.log(`\n  ⚠️  There are still ${remainingERC721.rows[0].count} ERC721 transfers to process.`);
      console.log('     Run this script again to process more.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    console.log('\n✅ NFT transfer backfill completed!');
  }
}

main().catch(console.error);
