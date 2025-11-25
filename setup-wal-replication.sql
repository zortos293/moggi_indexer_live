-- ============================================
-- WAL LOGICAL REPLICATION SETUP FOR LOGS TABLE
-- ============================================

-- STEP 1: Run these on your LOCAL PostgreSQL (source)
-- ============================================

-- Check if WAL level is correct
SHOW wal_level;
-- Should return 'logical'. If not, you need to modify postgresql.conf

-- Check replication slots
SHOW max_replication_slots;
-- Should be at least 10

-- Create replication user (run as superuser)
CREATE USER replication_user WITH REPLICATION LOGIN PASSWORD 'your_secure_password_here';

-- Grant permissions
GRANT CONNECT ON DATABASE postgres TO replication_user;
GRANT USAGE ON SCHEMA public TO replication_user;
GRANT SELECT ON logs TO replication_user;

-- Create publication for logs table only
CREATE PUBLICATION logs_migration FOR TABLE logs;

-- Verify publication
SELECT * FROM pg_publication;
SELECT * FROM pg_publication_tables WHERE pubname = 'logs_migration';

-- ============================================
-- STEP 2: Check what's needed in pg_hba.conf
-- ============================================
-- Add this line to pg_hba.conf (replace with your actual source IP):
-- host replication replication_user 0.0.0.0/0 md5
--
-- Or for specific PlanetScale IPs (check their docs):
-- host replication replication_user <planetscale_ip>/32 md5

-- After modifying pg_hba.conf, reload PostgreSQL:
-- On Windows: Restart PostgreSQL service
-- On Linux: sudo systemctl reload postgresql

-- ============================================
-- STEP 3: Run these on PLANETSCALE PostgreSQL (target)
-- ============================================

-- Create subscription (replace connection details)
CREATE SUBSCRIPTION logs_subscription
    CONNECTION 'host=YOUR_PUBLIC_IP_OR_DOMAIN
                port=5432
                dbname=postgres
                user=replication_user
                password=your_secure_password_here'
    PUBLICATION logs_migration
    WITH (copy_data = true, create_slot = true);

-- This will:
-- 1. Create a replication slot on source
-- 2. Copy existing data (initial sync)
-- 3. Start streaming new changes

-- ============================================
-- STEP 4: Monitor replication
-- ============================================

-- Check subscription status (on PlanetScale)
SELECT * FROM pg_subscription;
SELECT * FROM pg_stat_subscription;

-- Check replication lag (on PlanetScale)
SELECT
    subname,
    received_lsn,
    latest_end_lsn,
    latest_end_time,
    last_msg_send_time,
    last_msg_receipt_time
FROM pg_stat_subscription;

-- Check replication slot status (on source)
SELECT
    slot_name,
    plugin,
    slot_type,
    active,
    active_pid,
    restart_lsn,
    confirmed_flush_lsn,
    wal_status
FROM pg_replication_slots;

-- ============================================
-- STEP 5: After migration complete - cleanup
-- ============================================

-- On PlanetScale (target)
DROP SUBSCRIPTION logs_subscription;

-- On source
DROP PUBLICATION logs_migration;
DROP USER replication_user;
