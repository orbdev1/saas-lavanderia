import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';

const poolMax = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) throw new Error('DB_POOL_MAX debe ser un entero entre 1 y 100');
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  options: '-c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000',
});
export const db = drizzle(pool);
export type Executor = Pick<typeof db, 'execute'>;
export async function rows<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T[]> {
  return (await executor.execute(query)).rows as T[];
}
export async function one<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T | undefined> { return (await rows<T>(executor, query))[0]; }
export { sql };
