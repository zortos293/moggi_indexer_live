import { PoolClient } from 'pg';

/**
 * Constructs and executes a single INSERT statement with multiple VALUES rows
 * This is significantly faster than individual INSERT statements
 */
export async function batchInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: any[][],
  onConflictClause?: string
): Promise<void> {
  if (rows.length === 0) return;

  // Build placeholders: ($1, $2, $3), ($4, $5, $6), ...
  const numCols = columns.length;
  const valuePlaceholders: string[] = [];
  const flatValues: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowPlaceholders: string[] = [];
    for (let j = 0; j < numCols; j++) {
      const paramIndex = i * numCols + j + 1;
      rowPlaceholders.push(`$${paramIndex}`);
      flatValues.push(rows[i][j]);
    }
    valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  let query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuePlaceholders.join(', ')}`;

  if (onConflictClause) {
    query += ` ${onConflictClause}`;
  }

  await client.query(query, flatValues);
}

/**
 * Batch insert with chunking to avoid PostgreSQL parameter limits
 * PostgreSQL has a limit of ~65535 parameters per query
 */
export async function batchInsertChunked(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: any[][],
  onConflictClause?: string,
  chunkSize: number = 100
): Promise<void> {
  if (rows.length === 0) return;

  // Calculate max rows per chunk based on parameter limit
  const numCols = columns.length;
  const maxParams = 65000; // Stay under 65535 limit
  const maxRowsPerChunk = Math.floor(maxParams / numCols);
  const effectiveChunkSize = Math.min(chunkSize, maxRowsPerChunk);

  for (let i = 0; i < rows.length; i += effectiveChunkSize) {
    const chunk = rows.slice(i, i + effectiveChunkSize);
    await batchInsert(client, table, columns, chunk, onConflictClause);
  }
}
