-- Drop all tables in PostgreSQL (run this before migration)
-- Execute with: psql or through your PostgreSQL client

DROP TABLE IF EXISTS erc721_transfers CASCADE;
DROP TABLE IF EXISTS erc20_transfers CASCADE;
DROP TABLE IF EXISTS address_transactions CASCADE;
DROP TABLE IF EXISTS addresses CASCADE;
DROP TABLE IF EXISTS erc1155_tokens CASCADE;
DROP TABLE IF EXISTS erc721_tokens CASCADE;
DROP TABLE IF EXISTS erc20_tokens CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS blocks CASCADE;
DROP TABLE IF EXISTS indexer_state CASCADE;

-- Verify all tables are dropped
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
