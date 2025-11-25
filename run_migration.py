import asyncio
import asyncpg

async def run_migration():
    try:
        # Connect to PostgreSQL
        conn = await asyncpg.connect(
            host='127.0.0.1',
            port=5432,
            user='postgres',
            password='',
            database='postgres'
        )

        # Read migration file
        with open('migrations/add_protocol_metadata.sql', 'r') as f:
            sql = f.read()

        # Execute migration
        await conn.execute(sql)

        print('SUCCESS: Migration completed successfully!')
        print('SUCCESS: Created tables: protocols, contract_metadata')

        # Verify tables exist
        tables = await conn.fetch("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('protocols', 'contract_metadata')
        """)

        print(f'\nSUCCESS: Verified tables exist:')
        for table in tables:
            print(f'   - {table["table_name"]}')

        await conn.close()

    except Exception as e:
        print(f'ERROR: Error running migration: {e}')
        raise

if __name__ == '__main__':
    asyncio.run(run_migration())
