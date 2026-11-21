import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';

/**
 * The small slice of a Postgres client the API needs. Two implementations:
 * a real Postgres pool for production, and PGlite (Postgres compiled to WASM,
 * running in-process) for tests and for local development without Docker.
 * Both speak the same SQL, so the repositories are written once.
 */
export interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

export interface Db extends Queryable {
  /** Runs several statements separated by semicolons; used only by migrations. */
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPostgresDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 10 });
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      const result = await pool.query(sql, [...params]);
      return result.rows as Row[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          async query<Row>(sql: string, params: readonly unknown[] = []) {
            return (await client.query(sql, [...params])).rows as Row[];
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** `dataDir` undefined keeps everything in memory (tests). */
export async function createEmbeddedDb(dataDir?: string): Promise<Db> {
  const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  await pglite.waitReady;
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      return (await pglite.query<Row>(sql, [...params])).rows;
    },
    async exec(sql) {
      await pglite.exec(sql);
    },
    async transaction(work) {
      return (await pglite.transaction(async (tx) =>
        work({
          async query<Row>(sql: string, params: readonly unknown[] = []) {
            return (await tx.query<Row>(sql, [...params])).rows;
          },
        }),
      )) as Awaited<ReturnType<typeof work>>;
    },
    async close() {
      await pglite.close();
    },
  };
}
