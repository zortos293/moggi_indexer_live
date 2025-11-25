from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from contextlib import asynccontextmanager
from database import init_pool, close_pool, get_pool
from typing import Optional
import orjson

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await close_pool()

app = FastAPI(
    title="Monad Indexer API",
    default_response_class=ORJSONResponse,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to format block response
def format_block(row):
    return {
        "number": str(row["number"]),
        "hash": row["hash"],
        "parentHash": row["parent_hash"],
        "timestamp": str(row["timestamp"]),
        "miner": row["miner"],
        "gasLimit": str(row["gas_limit"]),
        "gasUsed": str(row["gas_used"]),
        "baseFeePerGas": row["base_fee_per_gas"] or "0",
        "difficulty": row["difficulty"] or "0",
        "totalDifficulty": row["total_difficulty"] or "0",
        "transactionCount": row["transaction_count"],
        "nonce": row["nonce"],
        "sha3Uncles": row["sha3_uncles"],
        "logsBloom": row["logs_bloom"],
        "transactionsRoot": row["transactions_root"],
        "stateRoot": row["state_root"],
        "receiptsRoot": row["receipts_root"],
        "extraData": row["extra_data"],
        "size": row["size"]
    }

# Helper to format transaction response
def format_transaction(row):
    tx = {
        "hash": row["hash"],
        "from": row["from_address"],
        "to": row["to_address"],
        "value": row["value"],
        "gas": str(row["gas"]),
        "gasUsed": str(row["gas_used"]) if row["gas_used"] else "0",
        "blockNumber": str(row["block_number"]),
        "blockHash": row["block_hash"],
        "timestamp": str(row["timestamp"]) if "timestamp" in row.keys() else "0",
        "transactionIndex": row["transaction_index"],
        "nonce": row["nonce"],
        "input": row["input"],
        "status": row["status"] == 1 if row["status"] is not None else None,
        "type": row["type"],
        "chainId": row["chain_id"],
    }

    if row.get("gas_price"):
        tx["gasPrice"] = row["gas_price"]
    if row.get("max_fee_per_gas"):
        tx["maxFeePerGas"] = row["max_fee_per_gas"]
    if row.get("max_priority_fee_per_gas"):
        tx["maxPriorityFeePerGas"] = row["max_priority_fee_per_gas"]
    if row.get("effective_gas_price"):
        tx["effectiveGasPrice"] = row["effective_gas_price"]
    if row.get("cumulative_gas_used"):
        tx["cumulativeGasUsed"] = str(row["cumulative_gas_used"])
    if row.get("v"):
        tx["v"] = row["v"]
    if row.get("r"):
        tx["r"] = row["r"]
    if row.get("s"):
        tx["s"] = row["s"]

    # Extract method ID from input
    if row["input"] and len(row["input"]) >= 10:
        tx["methodId"] = row["input"][:10]

    # Include event name if available
    if row.get("first_event_name"):
        tx["eventName"] = row["first_event_name"]

    return tx

# Helper to format address response
def format_address(row):
    return {
        "address": row["address"],
        "balance": row["balance"] or "0",
        "transactionCount": row["tx_count"] or 0,
        "firstSeenBlock": str(row["first_seen_block"]) if row["first_seen_block"] else "0",
        "lastSeenBlock": str(row["last_updated_block"]) if row["last_updated_block"] else "0",
        "isContract": row["is_contract"] == 1,
        "contractCode": None,
        "contractCreator": None,
        "contractCreationTx": None
    }

# Helper to format protocol response
def format_protocol(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "logoUrl": row["logo_url"],
        "website": row["website"],
        "twitter": row["twitter"],
        "github": row["github"],
        "docs": row["docs"],
        "discord": row["discord"],
        "telegram": row["telegram"],
        "isLive": row["is_live"],
        "indexedAt": str(row["indexed_at"]) if row["indexed_at"] else None
    }

# Helper to format contract metadata response
def format_contract_metadata(row):
    result = {
        "address": row["address"],
        "contractName": row["contract_name"],
        "nickname": row["nickname"],
        "notes": row["notes"],
        "indexedAt": str(row["indexed_at"]) if row["indexed_at"] else None
    }

    # Include protocol info if available
    if row.get("protocol_id"):
        result["protocol"] = {
            "id": row["protocol_id"],
            "name": row.get("protocol_name"),
            "description": row.get("protocol_description"),
            "logoUrl": row.get("protocol_logo_url"),
            "website": row.get("protocol_website"),
            "twitter": row.get("protocol_twitter"),
            "github": row.get("protocol_github"),
            "docs": row.get("protocol_docs"),
            "discord": row.get("protocol_discord"),
            "telegram": row.get("protocol_telegram"),
            "isLive": row.get("protocol_is_live")
        }
    else:
        result["protocol"] = None

    return result

# ===== BLOCKS ENDPOINTS =====

@app.get("/api/blocks/latest")
async def get_latest_blocks(limit: int = Query(10, ge=1, le=100)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Get max block number first (fast - uses primary key)
        max_block = await conn.fetchval("SELECT MAX(number) FROM blocks")
        if max_block is None:
            return {"data": [], "count": 0}

        # Fetch blocks by primary key range (much faster than ORDER BY)
        rows = await conn.fetch(
            "SELECT * FROM blocks WHERE number > $1 ORDER BY number DESC LIMIT $2",
            max_block - limit - 10, limit
        )

    blocks = [format_block(row) for row in rows]
    return {"data": blocks, "count": max_block}

@app.get("/api/blocks/{block_id}")
async def get_block(block_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Check if it's a number or hash
        if block_id.startswith("0x"):
            row = await conn.fetchrow(
                "SELECT * FROM blocks WHERE hash = $1",
                block_id
            )
        else:
            row = await conn.fetchrow(
                "SELECT * FROM blocks WHERE number = $1",
                int(block_id)
            )

    if not row:
        raise HTTPException(status_code=404, detail="Block not found")

    block = format_block(row)

    # Fetch transactions for this block with event names
    async with pool.acquire() as conn:
        tx_rows = await conn.fetch(
            """
            SELECT t.*, $2::bigint as timestamp,
                   (SELECT l.event_name FROM logs l
                    WHERE l.transaction_hash = t.hash AND l.event_name IS NOT NULL
                    ORDER BY l.log_index LIMIT 1) as first_event_name
            FROM transactions t
            WHERE t.block_number = $1
            ORDER BY t.transaction_index ASC
            LIMIT 100
            """,
            row["number"], row["timestamp"]
        )

    block["transactions"] = [format_transaction(tx) for tx in tx_rows]

    return block

@app.get("/api/blocks/{block_id}/transactions")
async def get_block_transactions(
    block_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    # Get block number
    async with pool.acquire() as conn:
        if block_id.startswith("0x"):
            block_row = await conn.fetchrow(
                "SELECT number, timestamp FROM blocks WHERE hash = $1",
                block_id
            )
        else:
            block_row = await conn.fetchrow(
                "SELECT number, timestamp FROM blocks WHERE number = $1",
                int(block_id)
            )

        if not block_row:
            raise HTTPException(status_code=404, detail="Block not found")

        block_number = block_row["number"]
        block_timestamp = block_row["timestamp"]

        rows = await conn.fetch(
            """
            SELECT t.*, $2::bigint as timestamp
            FROM transactions t
            WHERE t.block_number = $1
            ORDER BY t.transaction_index ASC
            LIMIT $3 OFFSET $4
            """,
            block_number, block_timestamp, limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT transaction_count FROM blocks WHERE number = $1",
            block_number
        )

    transactions = [format_transaction(row) for row in rows]
    total = count_row["transaction_count"] if count_row else 0

    return {
        "data": transactions,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/blocks/hash/{block_hash}")
async def get_block_by_hash(block_hash: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM blocks WHERE hash = $1",
            block_hash
        )

    if not row:
        raise HTTPException(status_code=404, detail="Block not found")

    return format_block(row)

# ===== TRANSACTIONS ENDPOINTS =====

@app.get("/api/transactions/latest")
async def get_latest_transactions(limit: int = Query(10, ge=1, le=100)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Get max block number first (fast)
        max_block = await conn.fetchval("SELECT MAX(number) FROM blocks")
        if max_block is None:
            return {"data": [], "count": 0}

        # Fetch transactions from recent blocks only (much faster)
        # Include first event name from logs for each transaction
        rows = await conn.fetch(
            """
            SELECT t.*, b.timestamp,
                   (SELECT l.event_name FROM logs l
                    WHERE l.transaction_hash = t.hash AND l.event_name IS NOT NULL
                    ORDER BY l.log_index LIMIT 1) as first_event_name
            FROM transactions t
            JOIN blocks b ON t.block_number = b.number
            WHERE t.block_number > $1
            ORDER BY t.block_number DESC, t.transaction_index DESC
            LIMIT $2
            """,
            max_block - 100, limit
        )

        # Estimate count from indexer_state or recent activity (avoid COUNT(*))
        estimated_count = await conn.fetchval(
            "SELECT COALESCE(SUM(transaction_count), 0) FROM blocks WHERE number > $1",
            max_block - 10000
        )

    transactions = [format_transaction(row) for row in rows]
    return {"data": transactions, "count": estimated_count or 0}

@app.get("/api/transactions/{tx_hash}")
async def get_transaction(tx_hash: str, enriched: bool = Query(False)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT t.*, b.timestamp
            FROM transactions t
            JOIN blocks b ON t.block_number = b.number
            WHERE t.hash = $1
            """,
            tx_hash
        )

    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")

    tx = format_transaction(row)

    if enriched:
        # Add enriched fields
        tx["inputInformation"] = {
            "original": row["input"] or "0x",
            "defaultView": row["input"] or "0x"
        }

        # Get logs for token transfers
        async with pool.acquire() as conn:
            logs = await conn.fetch(
                """
                SELECT l.*, e.symbol, e.name, e.decimals
                FROM logs l
                LEFT JOIN erc20_tokens e ON l.address = e.address
                WHERE l.transaction_hash = $1
                ORDER BY l.log_index
                """,
                tx_hash
            )

        erc20_transfers = []
        all_logs = []

        for log in logs:
            # Format log for response
            formatted_log = {
                "logIndex": log["log_index"],
                "address": log["address"],
                "topics": [t for t in [log["topic0"], log["topic1"], log["topic2"], log["topic3"]] if t],
                "data": log["data"] or "0x",
                "blockNumber": str(log["block_number"]),
                "transactionHash": log["transaction_hash"],
                "eventName": log["event_name"],
                "eventSignature": log["event_signature"],
                "decodedParams": None
            }

            # Parse decoded_params JSON if available
            if log["decoded_params"]:
                try:
                    import json
                    formatted_log["decodedParams"] = json.loads(log["decoded_params"])
                except:
                    formatted_log["decodedParams"] = log["decoded_params"]

            all_logs.append(formatted_log)

            # ERC20 Transfer event signature
            if log["topic0"] == "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
                if log["topic1"] and log["topic2"] and len(log["topic1"]) == 66 and len(log["topic2"]) == 66:
                    erc20_transfers.append({
                        "from": "0x" + log["topic1"][26:],
                        "to": "0x" + log["topic2"][26:],
                        "value": str(int(log["data"], 16)) if log["data"] and log["data"] != "0x" else "0",
                        "tokenAddress": log["address"],
                        "token": {
                            "address": log["address"],
                            "name": log["name"] or "Unknown",
                            "symbol": log["symbol"] or "???",
                            "decimals": log["decimals"] or 18
                        }
                    })

        tx["logs"] = all_logs
        tx["erc20TokensTransferred"] = erc20_transfers
        tx["erc721TokensTransferred"] = []
        tx["erc1155TokensTransferred"] = []

        # Calculate transaction fee
        if tx.get("gasUsed") and (tx.get("effectiveGasPrice") or tx.get("gasPrice")):
            gas_price = tx.get("effectiveGasPrice") or tx.get("gasPrice")
            # Handle hex strings
            if isinstance(gas_price, str) and gas_price.startswith("0x"):
                gas_price_int = int(gas_price, 16)
            else:
                gas_price_int = int(gas_price)
            tx["transactionFee"] = str(int(tx["gasUsed"]) * gas_price_int)

    return tx

# ===== ADDRESSES ENDPOINTS =====

@app.get("/api/addresses/{address}")
async def get_address(address: str):
    address = address.lower()
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM addresses WHERE address = $1",
            address
        )

        # Check if it's a contract - always query contracts table to handle data sync issues
        contract_row = await conn.fetchrow(
            "SELECT * FROM contracts WHERE address = $1",
            address
        )

    if not row:
        # Return default for unknown address
        return {
            "address": address,
            "balance": "0",
            "transactionCount": 0,
            "firstSeenBlock": "0",
            "lastSeenBlock": "0",
            "isContract": False,
            "contractCode": None,
            "contractCreator": None,
            "contractCreationTx": None
        }

    result = format_address(row)

    if contract_row:
        result["isContract"] = True  # Override if we have contract data
        result["contractCode"] = contract_row["bytecode"]
        result["contractCreator"] = contract_row["creator_address"]
        result["contractCreationTx"] = contract_row["creation_tx_hash"]

    return result

@app.get("/api/addresses/{address}/transactions")
async def get_address_transactions(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.*, b.timestamp,
                   (SELECT l.event_name FROM logs l
                    WHERE l.transaction_hash = t.hash AND l.event_name IS NOT NULL
                    ORDER BY l.log_index LIMIT 1) as first_event_name
            FROM transactions t
            JOIN blocks b ON t.block_number = b.number
            WHERE t.from_address = $1 OR t.to_address = $1
            ORDER BY t.block_number DESC, t.transaction_index DESC
            LIMIT $2 OFFSET $3
            """,
            address, limit, offset
        )

        count_row = await conn.fetchrow(
            """
            SELECT COUNT(*) as total
            FROM transactions
            WHERE from_address = $1 OR to_address = $1
            """,
            address
        )

    transactions = [format_transaction(row) for row in rows]
    total = count_row["total"]

    return {
        "data": transactions,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/addresses/{address}/token-balances")
async def get_address_token_balances(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Calculate token balances from transfers
        rows = await conn.fetch(
            """
            WITH balances AS (
                SELECT
                    token_address,
                    SUM(CASE WHEN to_address = $1 THEN CAST(value AS NUMERIC) ELSE 0 END) -
                    SUM(CASE WHEN from_address = $1 THEN CAST(value AS NUMERIC) ELSE 0 END) as balance
                FROM erc20_transfers
                WHERE from_address = $1 OR to_address = $1
                GROUP BY token_address
                HAVING SUM(CASE WHEN to_address = $1 THEN CAST(value AS NUMERIC) ELSE 0 END) -
                       SUM(CASE WHEN from_address = $1 THEN CAST(value AS NUMERIC) ELSE 0 END) > 0
            )
            SELECT b.token_address, b.balance, t.name, t.symbol, t.decimals, t.total_supply
            FROM balances b
            LEFT JOIN erc20_tokens t ON b.token_address = t.address
            ORDER BY b.balance DESC
            LIMIT $2 OFFSET $3
            """,
            address, limit, offset
        )

        count_row = await conn.fetchrow(
            """
            SELECT COUNT(DISTINCT token_address) as total
            FROM erc20_transfers
            WHERE from_address = $1 OR to_address = $1
            """,
            address
        )

    balances = []
    for row in rows:
        balances.append({
            "tokenAddress": row["token_address"],
            "holderAddress": address,
            "balance": str(int(row["balance"])),
            "token": {
                "address": row["token_address"],
                "name": row["name"] or "Unknown",
                "symbol": row["symbol"] or "???",
                "decimals": row["decimals"] or 18,
                "totalSupply": row["total_supply"] or "0"
            }
        })

    total = count_row["total"]

    return {
        "data": balances,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/addresses/{address}/token-transfers")
async def get_address_token_transfers(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT et.*, t.name, t.symbol, t.decimals, b.timestamp
            FROM erc20_transfers et
            LEFT JOIN erc20_tokens t ON et.token_address = t.address
            JOIN blocks b ON et.block_number = b.number
            WHERE et.from_address = $1 OR et.to_address = $1
            ORDER BY et.block_number DESC, et.log_index DESC
            LIMIT $2 OFFSET $3
            """,
            address, limit, offset
        )

        count_row = await conn.fetchrow(
            """
            SELECT COUNT(*) as total
            FROM erc20_transfers
            WHERE from_address = $1 OR to_address = $1
            """,
            address
        )

    transfers = []
    for row in rows:
        transfers.append({
            "from": row["from_address"],
            "to": row["to_address"],
            "value": row["value"],
            "tokenAddress": row["token_address"],
            "transactionHash": row["transaction_hash"],
            "blockNumber": str(row["block_number"]),
            "timestamp": str(row["timestamp"]),
            "logIndex": row["log_index"],
            "token": {
                "address": row["token_address"],
                "name": row["name"] or "Unknown",
                "symbol": row["symbol"] or "???",
                "decimals": row["decimals"] or 18
            }
        })

    total = count_row["total"]

    return {
        "data": transfers,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/addresses/{address}/internal-transactions")
async def get_address_internal_transactions(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    # Internal transactions not tracked in current schema
    return {
        "data": [],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": 0,
            "totalPages": 0
        }
    }

@app.get("/api/addresses/{address}/nfts")
async def get_address_nfts(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    type: Optional[str] = None
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Calculate NFT ownership from transfers
        rows = await conn.fetch(
            """
            WITH ownership AS (
                SELECT
                    token_address,
                    token_id,
                    SUM(CASE WHEN to_address = $1 THEN 1 ELSE 0 END) -
                    SUM(CASE WHEN from_address = $1 THEN 1 ELSE 0 END) as owned
                FROM erc721_transfers
                WHERE from_address = $1 OR to_address = $1
                GROUP BY token_address, token_id
                HAVING SUM(CASE WHEN to_address = $1 THEN 1 ELSE 0 END) -
                       SUM(CASE WHEN from_address = $1 THEN 1 ELSE 0 END) > 0
            )
            SELECT o.token_address, o.token_id, t.name, t.symbol
            FROM ownership o
            LEFT JOIN erc721_tokens t ON o.token_address = t.address
            ORDER BY o.token_address, o.token_id
            LIMIT $2 OFFSET $3
            """,
            address, limit, offset
        )

        count_row = await conn.fetchrow(
            """
            SELECT COUNT(*) as total FROM (
                SELECT token_address, token_id
                FROM erc721_transfers
                WHERE from_address = $1 OR to_address = $1
                GROUP BY token_address, token_id
                HAVING SUM(CASE WHEN to_address = $1 THEN 1 ELSE 0 END) -
                       SUM(CASE WHEN from_address = $1 THEN 1 ELSE 0 END) > 0
            ) sub
            """,
            address
        )

    nfts = []
    for row in rows:
        nfts.append({
            "collectionAddress": row["token_address"],
            "tokenId": row["token_id"],
            "owner": address,
            "collection": {
                "name": row["name"] or "Unknown",
                "symbol": row["symbol"] or "???",
                "tokenType": "ERC721"
            }
        })

    total = count_row["total"]

    return {
        "data": nfts,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/addresses/{address}/nft-transfers")
async def get_address_nft_transfers(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT et.*, t.name, t.symbol, b.timestamp
            FROM erc721_transfers et
            LEFT JOIN erc721_tokens t ON et.token_address = t.address
            JOIN blocks b ON et.block_number = b.number
            WHERE et.from_address = $1 OR et.to_address = $1
            ORDER BY et.block_number DESC, et.log_index DESC
            LIMIT $2 OFFSET $3
            """,
            address, limit, offset
        )

        count_row = await conn.fetchrow(
            """
            SELECT COUNT(*) as total
            FROM erc721_transfers
            WHERE from_address = $1 OR to_address = $1
            """,
            address
        )

    transfers = []
    for row in rows:
        transfers.append({
            "collectionAddress": row["token_address"],
            "tokenId": row["token_id"],
            "from": row["from_address"],
            "to": row["to_address"],
            "amount": "1",
            "tokenType": "ERC721",
            "transactionHash": row["transaction_hash"],
            "blockNumber": str(row["block_number"]),
            "timestamp": str(row["timestamp"]),
            "collection": {
                "name": row["name"] or "Unknown",
                "symbol": row["symbol"] or "???",
                "tokenType": "ERC721"
            }
        })

    total = count_row["total"]

    return {
        "data": transfers,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/addresses/contracts/list")
async def get_contracts_list(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.*, c.creator_address, c.creation_tx_hash, c.bytecode,
                   cm.contract_name, cm.nickname, cm.notes,
                   p.name as protocol_name, p.logo_url as protocol_logo_url, p.website as protocol_website
            FROM addresses a
            JOIN contracts c ON a.address = c.address
            LEFT JOIN contract_metadata cm ON a.address = cm.address
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            WHERE a.is_contract = 1
            ORDER BY a.first_seen_block DESC
            LIMIT $1 OFFSET $2
            """,
            limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM contracts"
        )

    contracts = []
    for row in rows:
        addr = format_address(row)
        addr["contractCode"] = row["bytecode"]
        addr["contractCreator"] = row["creator_address"]
        addr["contractCreationTx"] = row["creation_tx_hash"]

        # Add metadata if available
        if row["contract_name"] or row["nickname"]:
            addr["contractName"] = row["contract_name"]
            addr["nickname"] = row["nickname"]
            addr["notes"] = row["notes"]

        if row["protocol_name"]:
            addr["protocol"] = {
                "name": row["protocol_name"],
                "logoUrl": row["protocol_logo_url"],
                "website": row["protocol_website"]
            }

        contracts.append(addr)

    total = count_row["total"]

    return {
        "data": contracts,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

# ===== METADATA ENDPOINT =====

@app.get("/api/metadata/address/{address}")
async def get_address_metadata(address: str):
    address = address.lower()

    pool = await get_pool()
    async with pool.acquire() as conn:
        # First check for contract metadata (protocol info)
        contract_meta = await conn.fetchrow(
            """
            SELECT cm.*, p.name as protocol_name, p.logo_url as protocol_logo_url,
                   p.website as protocol_website
            FROM contract_metadata cm
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            WHERE cm.address = $1
            """,
            address
        )

        # Check if it's an ERC20 token
        erc20 = await conn.fetchrow(
            "SELECT * FROM erc20_tokens WHERE address = $1",
            address
        )

        if erc20:
            result = {
                "address": address,
                "name": erc20["name"] or "Unknown Token",
                "label": erc20["symbol"] or "???",
                "symbol": erc20["symbol"],
                "isToken": True,
                "tokenStandard": "ERC20",
                "decimals": erc20["decimals"] or 18
            }

            # Add protocol info if available
            if contract_meta:
                result["contractName"] = contract_meta["contract_name"]
                result["nickname"] = contract_meta["nickname"]
                if contract_meta["protocol_name"]:
                    result["protocol"] = {
                        "name": contract_meta["protocol_name"],
                        "logoUrl": contract_meta["protocol_logo_url"],
                        "website": contract_meta["protocol_website"]
                    }

            return result

        # Check if it's an ERC721 token
        erc721 = await conn.fetchrow(
            "SELECT * FROM erc721_tokens WHERE address = $1",
            address
        )

        if erc721:
            result = {
                "address": address,
                "name": erc721["name"] or "Unknown NFT",
                "label": erc721["symbol"] or "NFT",
                "symbol": erc721["symbol"],
                "isToken": True,
                "tokenStandard": "ERC721"
            }

            # Add protocol info if available
            if contract_meta:
                result["contractName"] = contract_meta["contract_name"]
                result["nickname"] = contract_meta["nickname"]
                if contract_meta["protocol_name"]:
                    result["protocol"] = {
                        "name": contract_meta["protocol_name"],
                        "logoUrl": contract_meta["protocol_logo_url"],
                        "website": contract_meta["protocol_website"]
                    }

            return result

        # Check if it's a contract
        contract = await conn.fetchrow(
            "SELECT * FROM contracts WHERE address = $1",
            address
        )

        if contract:
            result = {
                "address": address,
                "name": "Contract",
                "label": "Contract",
                "entityType": "Contract"
            }

            # Add protocol info if available
            if contract_meta:
                result["name"] = contract_meta["contract_name"] or contract_meta["nickname"] or "Contract"
                result["label"] = contract_meta["nickname"] or contract_meta["contract_name"] or "Contract"
                result["contractName"] = contract_meta["contract_name"]
                result["nickname"] = contract_meta["nickname"]
                result["notes"] = contract_meta["notes"]
                if contract_meta["protocol_name"]:
                    result["protocol"] = {
                        "name": contract_meta["protocol_name"],
                        "logoUrl": contract_meta["protocol_logo_url"],
                        "website": contract_meta["protocol_website"]
                    }

            return result

    # Not found - return 404
    raise HTTPException(status_code=404, detail="Metadata not found")

# ===== TOKEN ENDPOINTS =====

@app.get("/api/tokens")
async def get_tokens_list(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get all ERC20 tokens with stats
        rows = await conn.fetch(
            """
            SELECT
                t.address,
                t.name,
                t.symbol,
                t.decimals,
                t.total_supply,
                COALESCE(s.holder_count, 0) as holder_count,
                COALESCE(s.transfer_count, 0) as transfer_count
            FROM erc20_tokens t
            LEFT JOIN (
                SELECT
                    token_address,
                    COUNT(DISTINCT CASE WHEN to_address != '0x0000000000000000000000000000000000000000' THEN to_address END) as holder_count,
                    COUNT(*) as transfer_count
                FROM erc20_transfers
                GROUP BY token_address
            ) s ON t.address = s.token_address
            ORDER BY s.transfer_count DESC NULLS LAST, t.address
            LIMIT $1 OFFSET $2
            """,
            limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM erc20_tokens"
        )

    tokens = []
    for row in rows:
        tokens.append({
            "address": row["address"],
            "name": row["name"] or "Unknown Token",
            "symbol": row["symbol"] or "???",
            "decimals": row["decimals"] or 18,
            "totalSupply": row["total_supply"] or "0",
            "tokenType": "ERC20",
            "holderCount": row["holder_count"],
            "transferCount": row["transfer_count"]
        })

    total = count_row["total"] if count_row else 0

    return {
        "data": tokens,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/tokens/{address}")
async def get_token(address: str):
    address = address.lower()
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Check ERC20 first
        erc20 = await conn.fetchrow(
            "SELECT * FROM erc20_tokens WHERE address = $1",
            address
        )

        if erc20:
            # Get holder count (addresses with positive balance) and transfer count
            stats = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(*) FROM (
                        SELECT addr
                        FROM (
                            SELECT to_address as addr, CAST(value AS NUMERIC) as amount, 'in' as direction
                            FROM erc20_transfers
                            WHERE token_address = $1 AND to_address != '0x0000000000000000000000000000000000000000'
                            UNION ALL
                            SELECT from_address as addr, CAST(value AS NUMERIC) as amount, 'out' as direction
                            FROM erc20_transfers
                            WHERE token_address = $1 AND from_address != '0x0000000000000000000000000000000000000000'
                        ) transfers
                        GROUP BY addr
                        HAVING SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) > 0
                    ) holders) as holder_count,
                    COUNT(*) as transfer_count
                FROM erc20_transfers
                WHERE token_address = $1
                """,
                address
            )

            return {
                "address": address,
                "name": erc20["name"] or "Unknown Token",
                "symbol": erc20["symbol"] or "???",
                "decimals": erc20["decimals"] or 18,
                "totalSupply": erc20["total_supply"] or "0",
                "tokenType": "ERC20",
                "holderCount": stats["holder_count"] if stats else 0,
                "transferCount": stats["transfer_count"] if stats else 0
            }

        # Check ERC721
        erc721 = await conn.fetchrow(
            "SELECT * FROM erc721_tokens WHERE address = $1",
            address
        )

        if erc721:
            stats = await conn.fetchrow(
                """
                SELECT
                    COUNT(DISTINCT to_address) as holder_count,
                    COUNT(*) as transfer_count
                FROM erc721_transfers
                WHERE token_address = $1
                """,
                address
            )

            return {
                "address": address,
                "name": erc721["name"] or "Unknown NFT",
                "symbol": erc721["symbol"] or "???",
                "totalSupply": erc721["total_supply"] or "0",
                "tokenType": "ERC721",
                "holderCount": stats["holder_count"] if stats else 0,
                "transferCount": stats["transfer_count"] if stats else 0
            }

    raise HTTPException(status_code=404, detail="Token not found")

@app.get("/api/tokens/{address}/transfers")
async def get_token_transfers(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Check if ERC20
        erc20 = await conn.fetchrow(
            "SELECT * FROM erc20_tokens WHERE address = $1",
            address
        )

        if erc20:
            rows = await conn.fetch(
                """
                SELECT et.*, b.timestamp
                FROM erc20_transfers et
                JOIN blocks b ON et.block_number = b.number
                WHERE et.token_address = $1
                ORDER BY et.block_number DESC, et.log_index DESC
                LIMIT $2 OFFSET $3
                """,
                address, limit, offset
            )

            count_row = await conn.fetchrow(
                "SELECT COUNT(*) as total FROM erc20_transfers WHERE token_address = $1",
                address
            )

            transfers = []
            for row in rows:
                transfers.append({
                    "from": row["from_address"],
                    "to": row["to_address"],
                    "value": row["value"],
                    "transactionHash": row["transaction_hash"],
                    "blockNumber": str(row["block_number"]),
                    "timestamp": str(row["timestamp"]),
                    "logIndex": row["log_index"]
                })

            return {
                "data": transfers,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": count_row["total"],
                    "totalPages": (count_row["total"] + limit - 1) // limit
                },
                "token": {
                    "address": address,
                    "name": erc20["name"] or "Unknown",
                    "symbol": erc20["symbol"] or "???",
                    "decimals": erc20["decimals"] or 18
                }
            }

        # Check ERC721
        erc721 = await conn.fetchrow(
            "SELECT * FROM erc721_tokens WHERE address = $1",
            address
        )

        if erc721:
            rows = await conn.fetch(
                """
                SELECT et.*, b.timestamp
                FROM erc721_transfers et
                JOIN blocks b ON et.block_number = b.number
                WHERE et.token_address = $1
                ORDER BY et.block_number DESC, et.log_index DESC
                LIMIT $2 OFFSET $3
                """,
                address, limit, offset
            )

            count_row = await conn.fetchrow(
                "SELECT COUNT(*) as total FROM erc721_transfers WHERE token_address = $1",
                address
            )

            transfers = []
            for row in rows:
                transfers.append({
                    "from": row["from_address"],
                    "to": row["to_address"],
                    "tokenId": row["token_id"],
                    "transactionHash": row["transaction_hash"],
                    "blockNumber": str(row["block_number"]),
                    "timestamp": str(row["timestamp"]),
                    "logIndex": row["log_index"]
                })

            return {
                "data": transfers,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": count_row["total"],
                    "totalPages": (count_row["total"] + limit - 1) // limit
                },
                "token": {
                    "address": address,
                    "name": erc721["name"] or "Unknown",
                    "symbol": erc721["symbol"] or "???"
                }
            }

    raise HTTPException(status_code=404, detail="Token not found")

@app.get("/api/tokens/{address}/holders")
async def get_token_holders(
    address: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    address = address.lower()
    offset = (page - 1) * limit

    pool = await get_pool()
    async with pool.acquire() as conn:
        erc20 = await conn.fetchrow(
            "SELECT * FROM erc20_tokens WHERE address = $1",
            address
        )

        if erc20:
            rows = await conn.fetch(
                """
                WITH balances AS (
                    SELECT
                        addr as holder,
                        SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) as balance
                    FROM (
                        SELECT to_address as addr, CAST(value AS NUMERIC) as amount, 'in' as direction
                        FROM erc20_transfers
                        WHERE token_address = $1 AND to_address != '0x0000000000000000000000000000000000000000'
                        UNION ALL
                        SELECT from_address as addr, CAST(value AS NUMERIC) as amount, 'out' as direction
                        FROM erc20_transfers
                        WHERE token_address = $1 AND from_address != '0x0000000000000000000000000000000000000000'
                    ) transfers
                    GROUP BY addr
                    HAVING SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) > 0
                )
                SELECT holder, balance
                FROM balances
                ORDER BY balance DESC
                LIMIT $2 OFFSET $3
                """,
                address, limit, offset
            )

            count_row = await conn.fetchrow(
                """
                SELECT COUNT(*) as total FROM (
                    SELECT addr
                    FROM (
                        SELECT to_address as addr, CAST(value AS NUMERIC) as amount, 'in' as direction
                        FROM erc20_transfers
                        WHERE token_address = $1 AND to_address != '0x0000000000000000000000000000000000000000'
                        UNION ALL
                        SELECT from_address as addr, CAST(value AS NUMERIC) as amount, 'out' as direction
                        FROM erc20_transfers
                        WHERE token_address = $1 AND from_address != '0x0000000000000000000000000000000000000000'
                    ) transfers
                    GROUP BY addr
                    HAVING SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) > 0
                ) holders
                """,
                address
            )

            holders = []
            for row in rows:
                holders.append({
                    "address": row["holder"],
                    "balance": str(int(row["balance"]))
                })

            return {
                "data": holders,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": count_row["total"] if count_row else 0,
                    "totalPages": ((count_row["total"] if count_row else 0) + limit - 1) // limit
                },
                "token": {
                    "address": address,
                    "name": erc20["name"] or "Unknown",
                    "symbol": erc20["symbol"] or "???",
                    "decimals": erc20["decimals"] or 18
                }
            }

    raise HTTPException(status_code=404, detail="Token not found")

# ===== STATS ENDPOINT =====

@app.get("/api/stats")
async def get_stats():
    pool = await get_pool()
    async with pool.acquire() as conn:
        stats = await conn.fetchrow(
            """
            SELECT
                (SELECT MAX(number) FROM blocks) as latest_block,
                (SELECT COUNT(*) FROM transactions) as total_transactions,
                (SELECT COUNT(*) FROM contracts) as total_contracts,
                (SELECT COUNT(*) FROM erc20_tokens) as total_erc20_tokens,
                (SELECT COUNT(*) FROM erc721_tokens) as total_erc721_tokens
            """
        )

    return {
        "latestBlock": stats["latest_block"] or 0,
        "totalTransactions": stats["total_transactions"] or 0,
        "totalContracts": stats["total_contracts"] or 0,
        "totalErc20Tokens": stats["total_erc20_tokens"] or 0,
        "totalErc721Tokens": stats["total_erc721_tokens"] or 0
    }

# ===== PROTOCOL ENDPOINTS =====

@app.get("/api/protocols")
async def get_protocols_list(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM contract_metadata cm WHERE cm.protocol_id = p.id) as contract_count
            FROM protocols p
            ORDER BY p.name ASC
            LIMIT $1 OFFSET $2
            """,
            limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM protocols"
        )

    protocols = []
    for row in rows:
        protocol = format_protocol(row)
        protocol["contractCount"] = row["contract_count"]
        protocols.append(protocol)

    total = count_row["total"] if count_row else 0

    return {
        "data": protocols,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/protocols/{protocol_id}")
async def get_protocol(protocol_id: str):
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Try to find by ID or name
        if protocol_id.isdigit():
            row = await conn.fetchrow(
                "SELECT * FROM protocols WHERE id = $1",
                int(protocol_id)
            )
        else:
            row = await conn.fetchrow(
                "SELECT * FROM protocols WHERE LOWER(name) = LOWER($1)",
                protocol_id
            )

        if not row:
            raise HTTPException(status_code=404, detail="Protocol not found")

        protocol = format_protocol(row)

        # Get all contracts for this protocol
        contracts = await conn.fetch(
            """
            SELECT cm.*, c.creator_address, c.creation_tx_hash, c.creation_block_number,
                   c.is_erc20, c.is_erc721, c.is_erc1155, c.verified,
                   e20.name as token_name, e20.symbol as token_symbol, e20.decimals as token_decimals
            FROM contract_metadata cm
            LEFT JOIN contracts c ON cm.address = c.address
            LEFT JOIN erc20_tokens e20 ON cm.address = e20.address
            WHERE cm.protocol_id = $1
            ORDER BY cm.contract_name ASC
            """,
            row["id"]
        )

        protocol["contracts"] = []
        for contract in contracts:
            contract_info = {
                "address": contract["address"],
                "contractName": contract["contract_name"],
                "nickname": contract["nickname"],
                "notes": contract["notes"],
                "creatorAddress": contract["creator_address"],
                "creationTxHash": contract["creation_tx_hash"],
                "creationBlockNumber": str(contract["creation_block_number"]) if contract["creation_block_number"] else None,
                "isErc20": contract["is_erc20"],
                "isErc721": contract["is_erc721"],
                "isErc1155": contract["is_erc1155"],
                "verified": contract["verified"]
            }

            # Add token info if it's an ERC20
            if contract["token_name"] or contract["token_symbol"]:
                contract_info["tokenInfo"] = {
                    "name": contract["token_name"],
                    "symbol": contract["token_symbol"],
                    "decimals": contract["token_decimals"]
                }

            protocol["contracts"].append(contract_info)

    return protocol

@app.get("/api/protocols/{protocol_id}/contracts")
async def get_protocol_contracts(
    protocol_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Get protocol
        if protocol_id.isdigit():
            protocol_row = await conn.fetchrow(
                "SELECT * FROM protocols WHERE id = $1",
                int(protocol_id)
            )
        else:
            protocol_row = await conn.fetchrow(
                "SELECT * FROM protocols WHERE LOWER(name) = LOWER($1)",
                protocol_id
            )

        if not protocol_row:
            raise HTTPException(status_code=404, detail="Protocol not found")

        rows = await conn.fetch(
            """
            SELECT cm.*, c.creator_address, c.creation_tx_hash, c.creation_block_number,
                   c.is_erc20, c.is_erc721, c.is_erc1155, c.verified,
                   e20.name as token_name, e20.symbol as token_symbol, e20.decimals as token_decimals
            FROM contract_metadata cm
            LEFT JOIN contracts c ON cm.address = c.address
            LEFT JOIN erc20_tokens e20 ON cm.address = e20.address
            WHERE cm.protocol_id = $1
            ORDER BY cm.contract_name ASC
            LIMIT $2 OFFSET $3
            """,
            protocol_row["id"], limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM contract_metadata WHERE protocol_id = $1",
            protocol_row["id"]
        )

    contracts = []
    for contract in rows:
        contract_info = {
            "address": contract["address"],
            "contractName": contract["contract_name"],
            "nickname": contract["nickname"],
            "notes": contract["notes"],
            "creatorAddress": contract["creator_address"],
            "creationTxHash": contract["creation_tx_hash"],
            "creationBlockNumber": str(contract["creation_block_number"]) if contract["creation_block_number"] else None,
            "isErc20": contract["is_erc20"],
            "isErc721": contract["is_erc721"],
            "isErc1155": contract["is_erc1155"],
            "verified": contract["verified"]
        }

        if contract["token_name"] or contract["token_symbol"]:
            contract_info["tokenInfo"] = {
                "name": contract["token_name"],
                "symbol": contract["token_symbol"],
                "decimals": contract["token_decimals"]
            }

        contracts.append(contract_info)

    total = count_row["total"] if count_row else 0

    return {
        "data": contracts,
        "protocol": format_protocol(protocol_row),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

# ===== CONTRACT METADATA ENDPOINTS =====

@app.get("/api/contracts/{address}/metadata")
async def get_contract_metadata(address: str):
    address = address.lower()
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT cm.*,
                   p.name as protocol_name,
                   p.description as protocol_description,
                   p.logo_url as protocol_logo_url,
                   p.website as protocol_website,
                   p.twitter as protocol_twitter,
                   p.github as protocol_github,
                   p.docs as protocol_docs,
                   p.discord as protocol_discord,
                   p.telegram as protocol_telegram,
                   p.is_live as protocol_is_live
            FROM contract_metadata cm
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            WHERE cm.address = $1
            """,
            address
        )

        if not row:
            # Check if it's at least a known contract
            contract = await conn.fetchrow(
                "SELECT * FROM contracts WHERE address = $1",
                address
            )
            if not contract:
                raise HTTPException(status_code=404, detail="Contract metadata not found")

            # Return basic contract info without protocol metadata
            return {
                "address": address,
                "contractName": None,
                "nickname": None,
                "notes": None,
                "protocol": None,
                "indexedAt": None
            }

    return format_contract_metadata(row)

@app.get("/api/contracts/with-metadata")
async def get_contracts_with_metadata(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT cm.*,
                   p.name as protocol_name,
                   p.description as protocol_description,
                   p.logo_url as protocol_logo_url,
                   p.website as protocol_website,
                   p.twitter as protocol_twitter,
                   p.github as protocol_github,
                   p.docs as protocol_docs,
                   p.discord as protocol_discord,
                   p.telegram as protocol_telegram,
                   p.is_live as protocol_is_live,
                   c.creator_address,
                   c.creation_tx_hash,
                   c.creation_block_number,
                   c.is_erc20,
                   c.is_erc721,
                   c.is_erc1155,
                   c.verified
            FROM contract_metadata cm
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            LEFT JOIN contracts c ON cm.address = c.address
            ORDER BY p.name ASC, cm.contract_name ASC
            LIMIT $1 OFFSET $2
            """,
            limit, offset
        )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM contract_metadata"
        )

    contracts = []
    for row in rows:
        contract_info = format_contract_metadata(row)
        contract_info["creatorAddress"] = row["creator_address"]
        contract_info["creationTxHash"] = row["creation_tx_hash"]
        contract_info["creationBlockNumber"] = str(row["creation_block_number"]) if row["creation_block_number"] else None
        contract_info["isErc20"] = row["is_erc20"]
        contract_info["isErc721"] = row["is_erc721"]
        contract_info["isErc1155"] = row["is_erc1155"]
        contract_info["verified"] = row["verified"]
        contracts.append(contract_info)

    total = count_row["total"] if count_row else 0

    return {
        "data": contracts,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

@app.get("/api/contracts/search")
async def search_contracts_by_protocol(
    protocol: Optional[str] = None,
    name: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * limit
    pool = await get_pool()

    async with pool.acquire() as conn:
        # Build query based on filters
        where_clauses = []
        params = []
        param_count = 0

        if protocol:
            param_count += 1
            where_clauses.append(f"LOWER(p.name) LIKE LOWER(${param_count})")
            params.append(f"%{protocol}%")

        if name:
            param_count += 1
            where_clauses.append(f"(LOWER(cm.contract_name) LIKE LOWER(${param_count}) OR LOWER(cm.nickname) LIKE LOWER(${param_count}))")
            params.append(f"%{name}%")

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        query = f"""
            SELECT cm.*,
                   p.name as protocol_name,
                   p.description as protocol_description,
                   p.logo_url as protocol_logo_url,
                   p.website as protocol_website,
                   p.twitter as protocol_twitter,
                   p.github as protocol_github,
                   p.docs as protocol_docs,
                   p.discord as protocol_discord,
                   p.telegram as protocol_telegram,
                   p.is_live as protocol_is_live
            FROM contract_metadata cm
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            WHERE {where_sql}
            ORDER BY p.name ASC, cm.contract_name ASC
            LIMIT ${param_count + 1} OFFSET ${param_count + 2}
        """

        params.extend([limit, offset])
        rows = await conn.fetch(query, *params)

        count_query = f"""
            SELECT COUNT(*) as total
            FROM contract_metadata cm
            LEFT JOIN protocols p ON cm.protocol_id = p.id
            WHERE {where_sql}
        """
        count_row = await conn.fetchrow(count_query, *params[:-2])

    contracts = [format_contract_metadata(row) for row in rows]
    total = count_row["total"] if count_row else 0

    return {
        "data": contracts,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
