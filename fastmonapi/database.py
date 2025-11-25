import asyncpg
from config import PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD, PG_MAX_CONNECTIONS

pool = None

async def init_pool():
    global pool
    pool = await asyncpg.create_pool(
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD,
        min_size=10,
        max_size=PG_MAX_CONNECTIONS,
        command_timeout=60
    )
    return pool

async def close_pool():
    global pool
    if pool:
        await pool.close()

async def get_pool():
    global pool
    if pool is None:
        await init_pool()
    return pool
